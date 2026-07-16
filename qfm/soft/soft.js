
(function () {
  function b64d(s) {
    var bin = atob(s), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function decrypt(password) {
    var blob = window.QFM_SOFT_BLOB;
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    var key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64d(blob.salt), iterations: blob.iters,
        hash: "SHA-256" },
      keyMaterial, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64d(blob.iv) }, key, b64d(blob.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function render(content) {
    document.getElementById("secnav").innerHTML = content.nav;
    document.getElementById("content").innerHTML = content.body;
    document.getElementById("gate").style.display = "none";
    document.getElementById("app").hidden = false;
  }

  async function tryUnlock(pw) {
    try {
      var content = await decrypt(pw);
      sessionStorage.setItem("qfmSoftPw", pw);
      render(content);
      return true;
    } catch (e) { return false; }
  }

  document.getElementById("unlock").addEventListener("click", async function () {
    var pw = document.getElementById("pw").value.trim();
    var ok = await tryUnlock(pw);
    if (!ok) document.getElementById("gatemsg").textContent =
      "That's not it — check the text you were sent and try again.";
  });
  document.getElementById("pw").addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("unlock").click();
  });

  var saved = sessionStorage.getItem("qfmSoftPw") ||
              sessionStorage.getItem("qfmAdminPw");
  if (saved) tryUnlock(saved);
})();
