import { loadSettings, saveSettings } from "../lib/settings.js";

const saved = document.getElementById("saved");
const settings = await loadSettings();

async function save(values) {
  await saveSettings(values);
  saved.textContent = "Saved";
  setTimeout(() => (saved.textContent = ""), 1200);
}

for (const input of document.querySelectorAll("input[name]")) {
  if (input.type === "checkbox") {
    input.checked = Boolean(settings[input.name]);
    input.addEventListener("change", () => save({ [input.name]: input.checked }));
  } else if (input.type === "radio") {
    input.checked = settings[input.name] === input.value;
    input.addEventListener("change", () => input.checked && save({ [input.name]: input.value }));
  }
}
