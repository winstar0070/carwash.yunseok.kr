(() => {
  const installButton = document.getElementById("installAppBtn");
  const installHelp = document.getElementById("installHelp");
  const offlineStatus = document.getElementById("offlineStatus");
  let installPrompt = null;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function updateInstallState() {
    if (standalone()) {
      installButton.hidden = true;
      installHelp.textContent = "홈 화면 앱으로 사용 중입니다.";
    }
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = standalone();
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      installHelp.textContent = "브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.";
    }
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
    installHelp.textContent = "설치되었습니다. 홈 화면에서 실행할 수 있어요.";
  });
  updateInstallState();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(() => navigator.serviceWorker.ready).then(() => {
      offlineStatus.textContent = "오프라인 사용 준비 완료. 인터넷 없이도 계산할 수 있어요.";
    }).catch(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      offlineStatus.textContent = registration?.active
        ? "오프라인 사용 준비 완료. 인터넷 없이도 계산할 수 있어요."
        : "오프라인 준비를 마치지 못했어요. 인터넷 연결 후 다시 열어 주세요.";
    });
  } else {
    offlineStatus.textContent = "이 브라우저는 오프라인 저장을 지원하지 않아요.";
  }
})();
