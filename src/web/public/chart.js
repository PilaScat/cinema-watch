const root = document.querySelector("[data-trend]");

if (root) {
  const tooltip = root.querySelector("[data-trend-tooltip]");
  const formatter = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const show = (rect) => {
    const time = formatter.format(new Date(Number(rect.dataset.t)));
    tooltip.textContent = `${time} · ${tooltip.dataset.freeLabel} ${rect.dataset.free} · ${tooltip.dataset.goodLabel} ${rect.dataset.good}`;
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
