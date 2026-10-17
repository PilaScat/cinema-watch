const button = document.querySelector("button[data-home-picker]");
const field = document.querySelector("input[name=home]");
const DECIMALS = 5;

if (button && field && window.isSecureContext && "geolocation" in navigator) {
  button.hidden = false;
  button.addEventListener("click", () => {
    navigator.geolocation.getCurrentPosition((position) => {
      field.value = `${position.coords.latitude.toFixed(DECIMALS)}, ${position.coords.longitude.toFixed(DECIMALS)}`;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}
