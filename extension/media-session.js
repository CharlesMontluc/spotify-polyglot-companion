const eventName = "spotify-polyglot:media-session";

function publishMediaMetadata() {
  const metadata = navigator.mediaSession?.metadata;
  const payload = metadata
    ? {
      title: metadata.title || "",
      artist: metadata.artist || "",
      album: metadata.album || "",
    }
    : null;

  window.dispatchEvent(new CustomEvent(eventName, {
    detail: JSON.stringify(payload),
  }));
}

publishMediaMetadata();
window.setInterval(publishMediaMetadata, 1000);
