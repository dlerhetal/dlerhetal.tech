
(function () {
  var CONTENT = null;
  var PW = null;

  function b64d(s) {
    var bin = atob(s), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function decrypt(password) {
    var blob = window.QFM_ADMIN_BLOB;
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

  function render() {
    ["walk", "containers", "safety", "chat"].forEach(function (t) {
      document.getElementById("tab-" + t).innerHTML = CONTENT.tabs[t];
    });
    document.getElementById("gate").style.display = "none";
    document.getElementById("app").hidden = false;
    wireCopy();
    wireChat();
  }

  async function tryUnlock(pw) {
    try {
      CONTENT = await decrypt(pw);
      PW = pw;
      sessionStorage.setItem("qfmAdminPw", pw);
      render();
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

  var saved = sessionStorage.getItem("qfmAdminPw");
  if (saved) tryUnlock(saved);

  document.querySelectorAll(".tabbtn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tabbtn").forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      document.querySelectorAll(".tab").forEach(function (s) { s.hidden = true; });
      document.getElementById("tab-" + btn.dataset.tab).hidden = false;
    });
  });

  function wireCopy() {
    document.querySelectorAll(".copybtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var text = CONTENT.copies[btn.dataset.key];
        navigator.clipboard.writeText(text).then(function () {
          var old = btn.textContent;
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = old;
            btn.classList.remove("copied");
          }, 1600);
        });
      });
    });
  }

  var history = [];
  function addMsg(role, text) {
    var log = document.getElementById("chatlog");
    var div = document.createElement("div");
    div.className = "msg " + (role === "user" ? "you" : "bot");
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function wireChat() {
    var input = document.getElementById("chatinput");
    var send = document.getElementById("chatsend");
    var status = document.getElementById("chatstatus");
    async function go() {
      var q = input.value.trim();
      if (!q) return;
      input.value = "";
      addMsg("user", q);
      history.push({ role: "user", content: q });
      status.textContent = "Thinking...";
      send.disabled = true;
      try {
        var res = await fetch(CONTENT.relay + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: PW, messages: history.slice(-12) })
        });
        var j = await res.json();
        if (j.reply) {
          addMsg("assistant", j.reply);
          history.push({ role: "assistant", content: j.reply });
          status.textContent = "";
        } else {
          status.textContent = j.error || "Something went sideways — try again.";
        }
      } catch (e) {
        status.textContent = "Couldn't reach the assistant — check the internet and try again.";
      }
      send.disabled = false;
    }
    send.addEventListener("click", go);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") go();
    });
  }
})();
