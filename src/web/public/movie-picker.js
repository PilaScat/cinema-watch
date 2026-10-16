const select = document.querySelector("select[data-movie-picker]");
const form = select ? select.form : null;
let latest = 0;

function option(value, text) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  return element;
}

function fill(options, keep) {
  select.replaceChildren(...options);
  if (keep !== "" && options.some((element) => element.value === keep)) select.value = keep;
}

function checkedTheatres() {
  return [...form.querySelectorAll("input[name=theatre]:checked")].map((box) => box.value).slice(0, Number(select.dataset.max));
}

async function reload() {
  const texts = select.dataset;
  const keep = select.value;
  const theatres = checkedTheatres();
  latest += 1;
  const request = latest;
  if (theatres.length === 0) {
    fill([option("", texts.textNoTheatres)], keep);
    return;
  }
  try {
    const response = await fetch(`/api/movies?theatres=${encodeURIComponent(theatres.join(","))}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const movies = await response.json();
    if (request !== latest) return;
    if (movies.length === 0) {
      fill([option("", texts.textNone)], keep);
      return;
    }
    fill([option("", texts.textPick), ...movies.map((movie) => option(movie.slug, movie.label))], keep);
  } catch {
    if (request === latest) fill([option("", texts.textError)], keep);
  }
}

if (select && form) {
  form.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.name === "theatre") reload();
  });
}
