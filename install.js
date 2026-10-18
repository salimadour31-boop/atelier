const button = document.querySelector("#install");
const help = document.querySelector("#install-help");
let deferred = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferred = event;
});

button?.addEventListener("click", async () => {
  if (deferred) {
    deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    if (choice.outcome === "accepted") button.textContent = "Application installée";
    return;
  }
  const agent = navigator.userAgent;
  help.hidden = false;
  if (/android/i.test(agent)) {
    help.textContent = "Chrome : menu en haut à droite, puis Installer l’application.";
  } else if (/iphone|ipad/i.test(agent)) {
    help.textContent = "Safari : Partager, puis Sur l’écran d’accueil.";
  } else if (/macintosh/i.test(agent)) {
    help.textContent = "Chrome : menu, Installer Atelier. Safari : Partager, puis Ajouter au Dock.";
  } else {
    help.textContent = "Chrome ou Edge : menu, puis Installer Atelier. L’icône apparaît dans le menu Démarrer.";
  }
});

if (window.matchMedia("(display-mode: standalone)").matches && button) button.hidden = true;
