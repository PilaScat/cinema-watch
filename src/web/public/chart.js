const root = document.querySelector("[data-trend]");

if (root) {
  const tooltip = root.querySelector("[data-trend-tooltip]");
  const show = (rect) => {
    tooltip.textContent = `${rect.dataset.label} · ${tooltip.dataset.freeLabel} ${rect.dataset.free} · ${tooltip.dataset.goodLabel} ${rect.dataset.good}`;
    tooltip.hidden = false;
  };

  root.querySelectorAll("rect[data-t]").forEach((rect) => {
    rect.addEventListener("mouseover", () => show(rect));
    rect.addEventListener("focus", () => show(rect));
  });
  root.querySelector("svg")?.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
  });
}
