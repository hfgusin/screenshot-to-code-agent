from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol, Tuple

# Device viewports the screenshot_preview tool renders at. Shared by every
# backend so previews are consistently sized regardless of how they're rendered.
VIEWPORT_SIZES: Dict[str, Tuple[int, int]] = {
    "desktop": (1280, 832),
    "mobile": (342, 684),
}


@dataclass
class PreviewDiagnostic:
    type: str
    message: str
    url: str | None = None
    status: int | None = None

    def to_dict(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "type": self.type,
            "message": self.message,
        }
        if self.url:
            payload["url"] = self.url
        if self.status is not None:
            payload["status"] = self.status
        return payload


@dataclass
class ScreenshotCaptureResult:
    image_bytes: bytes
    diagnostics: List[PreviewDiagnostic] = field(default_factory=lambda: [])


class ScreenshotBackend(Protocol):
    """A pluggable renderer for screenshot_preview.

    The default is local Chromium (``PlaywrightBackend``); a deployment can
    register an alternative — e.g. an external rendering API — via
    ``set_screenshot_backend`` without the feature code knowing anything about
    it. The screenshot_preview tool talks only to this interface.
    """

    async def capture(
        self,
        html: str,
        device: str,
        full_page: bool,
    ) -> bytes | ScreenshotCaptureResult:
        """Render ``html`` to PNG bytes at the given device viewport."""
        ...

    async def available(self) -> bool:
        """Whether this backend can run here (warming it up if needed)."""
        ...
