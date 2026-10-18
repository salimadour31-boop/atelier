const button = document.querySelector("#install");
const help = document.querySelector("#install-help");
let deferred = null;
const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event;
  if (button) button.textContent = "Installer l’application";
});

if (safari && help) {
  help.hidden = false;
  help.textContent = "Safari ne peut pas installer l’application avec ce bouton. Ouvre ce lien dans Chrome, puis clique sur Installer. Dans Safari : bouton Partager, puis Ajouter au Dock.";
}

button?.addEventListener("click", async () => {
  if (deferred) {
    deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    if (choice.outcome === "accepted" && button) button.textContent = "Application installée";
    return;
  }
  if (help) help.hidden = false;
});

if (window.matchMedia("(display-mode: standalone)").matches && button) button.hidden = true;
