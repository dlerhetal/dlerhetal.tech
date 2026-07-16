
(function () {
  var RELAY = "https://dlerhetal.pythonanywhere.com/qfm-api";
  var PW = null;

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
      PW = pw;
      sessionStorage.setItem("qfmSoftPw", pw);
      render(content);
      initReview();
      return true;
    } catch (e) { return false; }
  }

  var noteCount = 0;

  function initReview() {
    var bar = document.getElementById("reviewbar");
    if (!bar || bar.dataset.ready) return;
    bar.dataset.ready = "1";
    bar.hidden = false;
    bar.innerHTML =
      '<button id="revtoggle" type="button"></button>' +
      '<span id="revcount" hidden>notes filed this session: 0</span>' +
      '<a id="revlink" href="/qfm/feedback/" target="_blank" rel="noopener" hidden>view punch list</a>';

    function setState(on) {
      document.body.classList.toggle("review", on);
      sessionStorage.setItem("qfmSoftReview", on ? "1" : "0");
      document.getElementById("revtoggle").textContent =
        "Review mode: " + (on ? "ON" : "OFF");
      document.getElementById("revcount").hidden = !on;
      document.getElementById("revlink").hidden = !on;
    }
    document.getElementById("revtoggle").addEventListener("click", function () {
      setState(!document.body.classList.contains("review"));
    });

    document.querySelectorAll("#content section").forEach(function (sec) {
      var h2 = sec.querySelector("h2");
      if (!h2) return;
      var btn = document.createElement("button");
      btn.className = "notebtn";
      btn.type = "button";
      btn.textContent = "+ note";
      var box = document.createElement("div");
      box.className = "notebox";
      box.hidden = true;
      box.innerHTML =
        '<textarea maxlength="4000" placeholder="One issue per note — file as many as you like."></textarea>' +
        '<div class="noterow"><button class="notesend" type="button">File it</button>' +
        '<span class="noteflash"></span></div>';
      btn.addEventListener("click", function () {
        box.hidden = !box.hidden;
        if (!box.hidden) box.querySelector("textarea").focus();
      });
      box.querySelector(".notesend").addEventListener("click", function () {
        var ta = box.querySelector("textarea");
        var flash = box.querySelector(".noteflash");
        var msg = ta.value.trim();
        if (!msg) {
          flash.textContent = "Write the note first.";
          flash.className = "noteflash err";
          return;
        }
        var topic = ("soft-hub: " + sec.id + " — " + h2.textContent).slice(0, 200);
        flash.textContent = "Filing…";
        flash.className = "noteflash";
        fetch(RELAY + "/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", topic: topic, message: msg, password: PW })
        })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) {
              flash.textContent = (res.j && res.j.error) || "Save failed — try again.";
              flash.className = "noteflash err";
              return;
            }
            noteCount++;
            document.getElementById("revcount").textContent =
              "notes filed this session: " + noteCount;
            ta.value = "";
            flash.textContent = "Filed ✓";
            flash.className = "noteflash ok";
            setTimeout(function () {
              if (flash.textContent === "Filed ✓") flash.textContent = "";
            }, 2500);
          })
          .catch(function () {
            flash.textContent = "Relay unreachable — try again.";
            flash.className = "noteflash err";
          });
      });
      sec.insertBefore(box, h2.nextSibling);
      sec.appendChild(btn);
    });

    setState(sessionStorage.getItem("qfmSoftReview") === "1");
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
