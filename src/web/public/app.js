const THEME_KEY = "cinema-watch-theme";
const ARM_MS = 5000;

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "system";
  } catch {
    return "system";
  }
}

function applyTheme(choice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice));
  });
}

function bindTheme() {
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const choice = button.dataset.themeChoice;
      try {
        localStorage.setItem(THEME_KEY, choice);
      } catch {
        return applyTheme(choice);
      }
      applyTheme(choice);
    });
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(readTheme()));
  applyTheme(readTheme());
}

function disarm(button) {
  button.dataset.armed = "false";
  const label = button.querySelector("[data-label]");
  if (label && button.dataset.idleLabel) label.textContent = button.dataset.idleLabel;
}

function bindConfirm() {
  document.querySelectorAll("button[data-confirm]").forEach((button) => {
    const label = button.querySelector("[data-label]");
    button.dataset.idleLabel = label ? label.textContent : "";
    let timer = 0;
    button.addEventListener("click", (event) => {
      if (button.dataset.armed === "true") return;
      event.preventDefault();
      button.dataset.armed = "true";
      if (label) label.textContent = button.dataset.confirm;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => disarm(button), ARM_MS);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") disarm(button);
    });
  });
}

function bindBusy() {
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      const submitter = event.submitter;
      if (!submitter || submitter.dataset.armed === "false") return;
      submitter.dataset.busy = "true";
      window.setTimeout(() => submitter.setAttribute("disabled", "true"), 0);
    });
  });
}

bindTheme();
bindConfirm();
bindBusy();
