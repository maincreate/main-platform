"use strict";
(() => {
  const button = document.getElementById("signout");
  const status = document.getElementById("signoutStatus");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    const options = {credentials: "same-origin", cache: "no-store"};
    try {
      const response = await fetch("/api/local/session", options);
      if (!response.ok) throw new Error("Unable to read your session");
      const {authenticated, csrf} = await response.json();
      if (authenticated) {
        const logout = await fetch("/api/local/logout", {
          ...options, method: "POST", headers: {"x-maincreate-csrf": csrf},
        });
        if (!logout.ok && logout.status !== 401) throw new Error("Unable to sign out");
      }
      window.location.replace("/setup");
    } catch {
      status.textContent = "Couldn’t sign out. Try again.";
      button.disabled = false;
    }
  });
})();
