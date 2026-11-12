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

function bindFilePickers() {
  document.querySelectorAll("input[data-file-input]").forEach((input) => {
    const name = input.parentElement.querySelector("[data-file-name]");
    const show = () => {
      const [file] = input.files;
      name.textContent = file ? file.name : name.dataset.empty;
    };
    input.addEventListener("change", show);
    show();
  });
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

function bindPreview() {
  document.querySelectorAll("button[data-preview]").forEach((button) => {
    button.addEventListener("click", async () => {
      const panel = button.closest("[data-preview-row]")?.querySelector("[data-preview-panel]");
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (!open || panel.dataset.loaded === "true") return;
      button.dataset.busy = "true";
      try {
        const response = await fetch(button.dataset.preview, { headers: { accept: "text/html" } });
        const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
        panel.replaceChildren(...parsed.body.childNodes);
        panel.dataset.loaded = String(response.ok);
      } catch {
        panel.hidden = true;
        button.setAttribute("aria-expanded", "false");
      } finally {
        delete button.dataset.busy;
      }
    });
  });
}

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  document.querySelectorAll("[data-busy]").forEach((button) => {
    button.removeAttribute("disabled");
    delete button.dataset.busy;
  });
});

bindTheme();
bindFilePickers();
bindConfirm();
bindBusy();
bindPreview();
