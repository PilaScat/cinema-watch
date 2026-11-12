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

const RESTORE_MS = 2500;

function say(button, text) {
  const label = button.querySelector("[data-label]");
  const idle = label.textContent;
  label.textContent = text;
  window.setTimeout(() => {
    label.textContent = idle;
  }, RESTORE_MS);
}

function showLink(button, url) {
  const field = button.closest("section").querySelector("input[data-wallet-url]");
  field.value = url;
  field.hidden = false;
  field.focus();
  field.select();
}

async function walletLink(button) {
  const response = await fetch(button.dataset.walletLink, { credentials: "same-origin" }).catch(() => null);
  const answer = response ? await response.json().catch(() => null) : null;
  if (!response || !response.ok || !answer || typeof answer.url !== "string") {
    say(button, button.dataset.failed);
    return;
  }
  if (button.dataset.mode === "share") {
    await navigator.share({ url: answer.url, title: button.dataset.shareTitle }).catch(() => undefined);
    return;
  }
  try {
    await navigator.clipboard.writeText(answer.url);
    say(button, button.dataset.done);
  } catch {
    showLink(button, answer.url);
  }
}

document.querySelectorAll("button[data-wallet-link]").forEach((button) => {
  if (button.dataset.mode === "share") {
    if (typeof navigator.share !== "function") return;
    button.hidden = false;
  }
  button.addEventListener("click", () => {
    void walletLink(button);
  });
});
