const canShareFiles = typeof navigator.share === "function" && typeof navigator.canShare === "function";

async function shareCard(button) {
  const response = await fetch(button.dataset.share, { credentials: "same-origin" });
  if (!response.ok) return;
  const file = new File([await response.blob()], "ticket.png", { type: "image/png" });
  if (!navigator.canShare({ files: [file] })) return;
  await navigator.share({ files: [file], title: button.dataset.shareTitle }).catch(() => undefined);
}

document.querySelectorAll("button[data-share]").forEach((button) => {
  if (!canShareFiles) return;
  button.hidden = false;
  button.addEventListener("click", () => {
    void shareCard(button);
  });
});
