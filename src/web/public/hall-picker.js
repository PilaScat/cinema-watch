const HIGHLIGHT_STROKE = "#f5c542";
const HIGHLIGHT_WIDTH = "3";

const form = document.querySelector("form[data-hall-picker]");
const rowsInput = form ? form.querySelector("input[name=rows]") : null;
const fromInput = form ? form.querySelector("input[name=seatFrom]") : null;
const toInput = form ? form.querySelector("input[name=seatTo]") : null;
const seats = [...document.querySelectorAll("rect[data-seat]")];

let anchor = null;

function parseSeat(rect) {
  const [row, number] = rect.dataset.seat.split("/");
  return { row, number: Number(number), y: Number(rect.getAttribute("y")) };
}

function readSelection() {
  const rows = rowsInput.value.split(",").map((row) => row.trim()).filter((row) => row !== "");
  const from = fromInput.value.trim() === "" ? null : Number(fromInput.value);
  const to = toInput.value.trim() === "" ? null : Number(toInput.value);
  return { rows, from, to };
}

function highlight() {
  const { rows, from, to } = readSelection();
  seats.forEach((rect) => {
    const seat = parseSeat(rect);
    const inside = rows.includes(seat.row) && (from === null || seat.number >= from) && (to === null || seat.number <= to);
    rect.dataset.selected = String(inside);
    if (inside) {
      rect.setAttribute("stroke", HIGHLIGHT_STROKE);
      rect.setAttribute("stroke-width", HIGHLIGHT_WIDTH);
    } else {
      rect.removeAttribute("stroke");
      rect.removeAttribute("stroke-width");
    }
  });
}

function rowsBetween(first, second, scope) {
  const low = Math.min(first.y, second.y);
  const high = Math.max(first.y, second.y);
  const found = new Map();
  scope.forEach((rect) => {
    const seat = parseSeat(rect);
    if (seat.y >= low && seat.y <= high) found.set(seat.row, seat.y);
  });
  return [...found.entries()].sort((a, b) => a[1] - b[1]).map(([row]) => row);
}

function choose(rect) {
  const seat = parseSeat(rect);
  if (anchor === null) {
    anchor = seat;
    rowsInput.value = seat.row;
    fromInput.value = String(seat.number);
    toInput.value = String(seat.number);
  } else {
    const scope = [...rect.closest("svg").querySelectorAll("rect[data-seat]")];
    rowsInput.value = rowsBetween(anchor, seat, scope).join(", ");
    fromInput.value = String(Math.min(anchor.number, seat.number));
    toInput.value = String(Math.max(anchor.number, seat.number));
    anchor = null;
  }
  highlight();
}

if (rowsInput && fromInput && toInput) {
  seats.forEach((rect) => {
    rect.addEventListener("click", () => choose(rect));
    rect.setAttribute("cursor", "pointer");
  });
  [rowsInput, fromInput, toInput].forEach((input) => input.addEventListener("input", highlight));
  highlight();
}
