"""SSRF-safe HTTP fetching for server-side requests to user-supplied URLs.

Two entry points:
  - safe_get(url): a standalone GET that follows redirects manually, validating
    the resolved IP of every hop and capping the response size. Used for image
    downloads and the HTML extractor.
  - safe_client(**kw): an httpx.AsyncClient whose transport validates the
    resolved IP before each connection — including every redirect hop, since
    httpx re-enters the transport per hop. Used by the WordPress importer, which
    passes one client through several helpers.

Both reject non-http(s) schemes and any host that resolves to a private,
loopback, link-local, multicast, reserved or unspecified address — so a public
URL cannot be used to reach localhost services or the home/cloud network.

Residual: DNS rebinding between the validation lookup and httpx's own connect
is not fully closed (we re-resolve per hop but do not pin the socket to the
checked IP). These fetches are editor-authenticated, which bounds the risk.
"""
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

DEFAULT_MAX_BYTES = 15 * 1024 * 1024
DEFAULT_MAX_REDIRECTS = 5
DEFAULT_TIMEOUT = 30

_DROP_HEADERS = {"content-encoding", "content-length", "transfer-encoding"}


class UnsafeURLError(Exception):
    """A URL targets a disallowed scheme or a non-public address."""


def _ip_is_blocked(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str.split("%")[0])  # drop IPv6 zone id
    except ValueError:
        return True
    return (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_multicast or addr.is_reserved or addr.is_unspecified
    )


def _assert_public_host(host: str | None) -> None:
    if not host:
        raise UnsafeURLError("missing host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise UnsafeURLError(f"cannot resolve host: {host}") from exc
    for info in infos:
        ip = info[4][0]
        if _ip_is_blocked(ip):
            raise UnsafeURLError(f"blocked non-public address {ip} for host {host}")


def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeURLError(f"blocked scheme: {parsed.scheme or '(none)'}")
    _assert_public_host(parsed.hostname)


async def safe_get(
    url: str,
    *,
    headers: dict | None = None,
    max_bytes: int = DEFAULT_MAX_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
    timeout: float = DEFAULT_TIMEOUT,
) -> httpx.Response:
    """GET a URL safely: http(s) only, no private-network targets (re-checked on
    each redirect), response body capped at max_bytes. Returns an httpx.Response
    with the (fully read) body available as .content / .text / .json()."""
    current = url
    redirects = 0
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        while True:
            _assert_safe_url(current)
            async with client.stream("GET", current, headers=headers) as resp:
                if resp.is_redirect and "location" in resp.headers:
                    redirects += 1
                    if redirects > max_redirects:
                        raise UnsafeURLError("too many redirects")
                    current = urljoin(current, resp.headers["location"])
                    continue
                total = 0
                chunks: list[bytes] = []
                async for chunk in resp.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise UnsafeURLError(f"response exceeds {max_bytes} bytes")
                    chunks.append(chunk)
                safe_headers = httpx.Headers(
                    {k: v for k, v in resp.headers.items() if k.lower() not in _DROP_HEADERS}
                )
                return httpx.Response(
                    status_code=resp.status_code,
                    headers=safe_headers,
                    content=b"".join(chunks),
                    request=resp.request,
                )


class _GuardTransport(httpx.AsyncHTTPTransport):
    """Validates each request's target (scheme + resolved IP) before connecting.
    httpx issues every redirect hop as a fresh request through the transport, so
    this guards redirects too."""

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.scheme not in ("http", "https"):
            raise UnsafeURLError(f"blocked scheme: {request.url.scheme or '(none)'}")
        _assert_public_host(request.url.host)
        return await super().handle_async_request(request)


def safe_client(**kwargs) -> httpx.AsyncClient:
    """An httpx.AsyncClient that blocks requests to non-public addresses on every
    hop. Accepts the usual AsyncClient kwargs (headers, timeout, follow_redirects)."""
    kwargs.setdefault("timeout", DEFAULT_TIMEOUT)
    return httpx.AsyncClient(transport=_GuardTransport(), **kwargs)
