/*
 * Making Words Studio — the Cunningham cycle (her literacy specialist's method) on eye gaze.  v1.1
 * (post adversarial review: transfer-safe fix flow, letter persistence,
 *  TTS self-test with on-screen fallback, secret-word clue path,
 *  per-phase nudge reset, dead-column handling, phase-aware skip.)
 *
 * Method rules encoded here (do not "improve" without checking the sources):
 *  - Never a buzzer, never "wrong". A mismatched attempt becomes compare-and-fix:
 *    correct letters LOCK IN PLACE (hers, kept), mismatched slots empty to a
 *    neutral dashed outline, and she fills only the gaps. TWO-STRIKE (dad 8/9,
 *    D50): the model word appears only on the SECOND miss of a word — the first
 *    miss sounds the word out (stressing the missing sounds) and she retries.
 *  - Letters persist across ladder words exactly like tiles in a holder:
 *    "change the first letter" means one slot empties, not a full respell.
 *  - Every word gets said in a sentence. Operations use her literacy specialist's script.
 *  - Wait time is sacred: nothing times out or advances without her (the one
 *    exception — the secret-word reveal — now waits for her choice).
 *  - Solo mode is the baseline. The partner strip (touch-only) adds control.
 *  - Assessment is invisible: everything logs quietly to /log.
 */
"use strict";
// lib/contract.js values via the index.html shim — the whitelist, not copies.
const EC = window.EllieContract.CONTRACT;

// ---------- state ----------
const S = {
  lesson: null, seq: null, seqIdx: 0,
  phase: "start",            // start | make | sort | transfer | secret | end
  wordIdx: 0,
  attempt: [],               // positional: letter | null per slot
  locked: [],                // slots she already has right (kept letters)
  fixing: false, misses: 0,  // misses on the CURRENT word (two-strike reveal, D50)
  sortIdx: 0,
  transferIdx: 0, transferStep: 0, // 0 = pick rhyming column, 1 = spell
  session: "s" + Date.now(),
  lastPromptAt: 0, nudges: 0,
  paused: false, tts: true,
  rated: false, part: "all", sortType: null, sortCols: null, transferType: null
};

const $ = (id) => document.getElementById(id);
const els = {
  start: $("sStart"), stage: $("stage"), big: $("sBig"), end: $("sEnd"),
  promptText: $("promptText"), promptSub: $("promptSub"),
  slots: $("slots"), model: $("model"), tray: $("tray"), cols: $("cols"),
  sortwordWrap: $("sortwordWrap"),
  bigTitle: $("bigTitle"), bigWord: $("big"), bigSub: $("bigSub"), bigRow: $("bigRow")
};
const VOWELS = "aeiou";

// ---------- logging (invisible assessment) ----------
function log(event, detail) {
  const rec = { t: Date.now(), session: S.session, lesson: S.lesson && S.lesson.lesson,
                phase: S.phase, event, ...detail };
  fetch("/log", { method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(rec) }).catch(() => {});
}

// ---------- speech (shared layer: ElevenLabs via server, Windows fallback) ----------
function say(text, opts) {
  if (!S.tts || !window.Speech) return Promise.resolve();
  return Speech.say(text, (opts && opts.kind) || "long");
}
function spellOut(word) { return word.split("").join(", "); }
// Letter sounds — she pairs name+sound on every offer/echo ("C, cuh"), sounds-only
// when reading a completed word ("cu, a, tah — cat!").
const SOUNDS = { a:"ah", b:"buh", c:"kuh", d:"duh", e:"eh", f:"fff", g:"guh", h:"huh",
  i:"ih", j:"juh", k:"kuh", l:"lll", m:"mmm", n:"nnn", o:"oh", p:"puh", q:"kwuh",
  r:"rrr", s:"sss", t:"tuh", u:"uh", v:"vvv", w:"wuh", x:"ks", y:"yuh", z:"zzz" };
function nameSound(L) { return L + ", " + (SOUNDS[L.toLowerCase()] || L); }
function soundOut(word) { return word.toLowerCase().split("").map(c => SOUNDS[c] || c).join(", "); }

// ---------- sentences ----------
const SENT = {
  as: "The ant is as small as a seed.", an: "We ate an ice cream.",
  and: "We sat and read a book.", has: "My friend has a pink bag.",
  had: "We had a garden party.", sad: "The giant was sad without his scarf.",
  sand: "We made a castle out of sand.", hand: "Wave your hand to say hello.",
  hands: "Clap your hands and cheer!", am: "I am six years old.",
  Sam: "Sam is a friend at school.", Pam: "Pam has a red hat.",
  map: "The pirate followed the map.", cap: "The boy wore a blue cap.",
  camp: "We sing songs at camp.", lamp: "The lamp lights the room.",
  lamps: "Two lamps glow at night.", clamps: "The builder uses clamps to hold wood.",
  us: "Mom reads to us every night.", sun: "The sun is bright today.",
  nut: "The squirrel hid a nut.", hut: "The hut has a grass roof.",
  huts: "Three little huts stood by the sea.", hunt: "We went on a pumpkin hunt!",
  hunts: "The fox hunts at night.", stun: "The magic trick will stun you.",
  nuts: "The jar is full of nuts.",
  it: "It is a sunny day.", in: "The cat is in the box.", ink: "The pen ran out of ink.",
  tin: "The cookies are in a tin.", kit: "The doctor has a first aid kit.",
  hit: "She hit the ball far.", hint: "I will give you a hint.",
  thin: "The paper is very thin.", think: "I think you are smart!"
};
let SENT_OVERRIDES = {};
function sentenceFor(w) {
  return SENT_OVERRIDES[w.toLowerCase()] || SENT[w] || SENT[w.toLowerCase()] || ("The word is " + w + ".");
}

// ---------- screens ----------
function show(which) {
  const bl = document.getElementById("bigList"); if (bl) bl.innerHTML = "";
  if (els.bigWord) els.bigWord.style.display = "";
  els.start.classList.remove("show"); els.big.classList.remove("show"); els.end.classList.remove("show");
  els.stage.style.display = "none";
  if (which === "stage") els.stage.style.display = "flex";
  else if (which) $(which).classList.add("show");
  $("replay").style.display = which === "stage" ? "flex" : "none";
  const t = document.getElementById("tally"); if (t && which !== "stage") t.style.display = "none";
}

// ---------- letter tray ----------
function buildTray(letters, withBackspace) {
  const cs = document.getElementById("colStacks"); if (cs) cs.remove();  // sort overlay never lingers
  $("stage").classList.remove("choosing");                               // pill zone recenters
  layoutTray(letters.length + (withBackspace ? 0.72 : 0));   // backspace occupies 0.72 units
  els.tray.innerHTML = "";
  for (const L of letters) {
    const d = document.createElement("div");
    d.className = "letter dwell" + (VOWELS.includes(L.toLowerCase()) ? " vowel" : "");
    d.textContent = L;
    d.dataset.letter = L;
    d.addEventListener("click", () => pickLetter(L));
    els.tray.appendChild(d);
  }
  if (withBackspace) {
    const b = document.createElement("div");
    b.className = "letter dwell small"; b.id = "backspace";
    b.textContent = "⌫"; b.setAttribute("data-dwell-ms", String(EC.holds.backspace));
    b.addEventListener("click", unpickLetter);
    els.tray.appendChild(b);
  }
  // inert park pad caps the right end (NOT .dwell — the parked cursor lands here)
  const pad = document.createElement("div");
  pad.id = "parkPad"; pad.setAttribute("aria-hidden", "true");
  els.tray.appendChild(pad);
}

// ---------- shared bottom choice tray (dad 7/28) ----------
// The "pick a column" motor plan, used by BOTH sort and first-letter transfer:
// the choice heads live in the full-bleed bottom band (same units/borders/vowel
// tint/park cap as the letter tray + TD Snap's bottom rows), and each choice's
// collected words STACK above its head. One implementation, two screens — so the
// two sorting-style screens never drift apart. Returns { heads[], stacks[] }
// index-aligned to `labels`; caller maps its own column indices onto them.
function buildChoiceTray(labels, onPick, holdMs) {
  const old = document.getElementById("colStacks"); if (old) old.remove();
  layoutTray(labels.length);
  els.tray.innerHTML = "";
  const stacks = document.createElement("div"); stacks.id = "colStacks";
  document.body.appendChild(stacks);
  const unitW = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--letterSize")) || 300;
  const bandH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--trayH")) || 324;
  const heads = [], stackEls = [];
  labels.forEach((label, k) => {
    const h = document.createElement("div");
    h.className = "letter dwell sorthead";
    h.setAttribute("data-dwell-ms", String(holdMs || 1600));   // a pick is a decision
    h.textContent = label;
    if (label.length === 1 && "aeiou".includes(label.toLowerCase())) h.classList.add("vowel");
    if (label.length > 1)                        // word heads (rhyme sorts) fit their cell
      h.style.fontSize = Math.min(unitW * 0.92 / (0.58 * label.length), bandH * 0.5) + "px";
    h.addEventListener("click", () => onPick(k));
    els.tray.appendChild(h);
    heads.push(h);
    const st = document.createElement("div");    // this choice's word stack, above the head
    st.className = "colstack";
    st.style.left = (k * unitW) + "px";
    st.style.width = unitW + "px";
    st.style.bottom = (bandH + 10) + "px";
    stacks.appendChild(st);
    stackEls.push(st);
  });
  const pad = document.createElement("div");     // park law: inert cap on the row
  pad.id = "parkPad"; pad.setAttribute("aria-hidden", "true");
  els.tray.appendChild(pad);
  return { heads, stacks: stackEls };
}

// ---------- slot helpers (positional, with locking) ----------
function secretWord() { return (S.lesson.secret_word || "").split("/")[0].trim(); }
function targetWordNow() {
  if (S.phase === "transfer") return currentTransferWord();
  if (S.phase === "secret") return secretWord();
  return currentWord();
}
function firstEmpty() { return S.attempt.findIndex(x => x === null); }
function isComplete() { return firstEmpty() === -1; }
function renderSlotsFrom(word, prefill) {
  layoutSlots(word.length);
  // prefill: array of letter|null; prefilled slots render locked (hers, kept)
  els.slots.innerHTML = "";
  S.attempt = []; S.locked = [];
  for (let i = 0; i < word.length; i++) {
    const s = document.createElement("div");
    s.className = "slot"; s.dataset.i = i;
    const ch = prefill ? prefill[i] : null;
    if (ch) { s.textContent = ch; s.classList.add("filled", "locked"); }
    els.slots.appendChild(s);
    S.attempt.push(ch || null);
    S.locked.push(!!ch);
  }
}
function renderModel(word) {
  els.model.innerHTML = "";
  if (!word) return;
  for (const ch of word) {
    const m = document.createElement("div");
    m.className = "m"; m.textContent = ch;
    els.model.appendChild(m);
  }
}
function resetNudges() { S.nudges = 0; S.lastPromptAt = Date.now(); try { updateTally(); } catch {} }

// small real-word dictionary: every word in the whole curriculum + common CVCs
let DICT = new Set();
function buildDict(db) {
  for (const l of db.lessons) {
    for (const w of l.make || []) DICT.add(w.toLowerCase());
    for (const c of (l.sort && l.sort.columns) || []) for (const w of c) DICT.add(w.toLowerCase());
    for (const w of (l.transfer && l.transfer.words) || []) DICT.add(w.toLowerCase());
  }
  for (const w of "has his her him hot hit hat hop top pot pit sit set net wet get got dog log big pig dig fun run sun bun cut but put".split(" ")) DICT.add(w);
  // K-2 rime-family vocabulary (Dolch/Fry-style short real words) so onset+rime
  // derivation finds real words for ANY lesson's families, early ones included
  const K2 =
    "bad dad had lad mad pad sad ban can fan man pan ran tan van plan than " +
    "band hand land sand stand brand grand gas bat cat fat mat pat rat sat flat that chat " +
    "cap gap lap map nap tap zap clap snap trap am bam ham jam ram yam slam swam " +
    "bag rag tag wag flag snag back pack rack sack tack black snack stack track quack " +
    "cash dash mash rash trash smash flash crash bell fell tell well sell shell smell spell swell " +
    "bed fed led red wed sled shed den hen men pen ten then when best nest rest test vest west chest " +
    "bet jet let met pet vet yet kick lick pick sick tick brick chick click stick trick quick " +
    "fig wig twig bill fill hill mill pill will chill drill grill skill spill still " +
    "bin fin pin tin win chin grin shin skin spin thin twin king ring sing wing bring sting swing thing " +
    "link pink rink sink wink blink drink think stink dip hip lip rip sip tip zip " +
    "chip clip drip flip grip ship skip slip snip trip whip bit fit kit lit wit quit spit " +
    "cob job mob rob sob dock lock rock sock block clock flock stock fog hog jog frog " +
    "cop mop pop chop drop flop shop stop cot dot lot not rot shot spot " +
    "cub hub rub sub tub club buck duck luck tuck stuck truck bug dug hug jug mug rug tug plug slug snug " +
    "gum hum sum yum drum plum spun stun bump dump jump lump pump stump bunk dunk junk sunk chunk skunk trunk " +
    "fail jail mail nail pail rail sail tail snail trail main pain rain brain chain plain train " +
    "bake cake fake lake make rake take wake brake flake shake snake male pale sale tale scale whale " +
    "came game name same tame blame flame frame date gate hate late mate plate skate state " +
    "bay day hay lay may pay ray say way clay play pray stay tray gray " +
    "beat heat meat neat seat treat wheat hide ride side wide bride slide dine fine line mine nine pine vine shine " +
    "light might night right sight tight bright joke poke woke broke smoke spoke " +
    "bore core more sore tore score shore snore store dew few new chew crew drew flew grew stew " +
    "fir sir stir ball call fall hall mall tall wall small jaw law paw raw saw claw draw straw " +
    "by my cry dry fly fry shy sky spy try why";
  for (const w of K2.split(" ")) DICT.add(w);
}
function isRealWord(w) { return DICT.has(w.toLowerCase()); }
// onsets for onset+rime derivation: single letters first (easier reads for her),
// then common blends/digraphs — every candidate is still dictionary-checked
const ONSETS = ("b c d f g h j k l m n p r s t v w y z " +
  "bl cl fl gl pl sl br cr dr fr gr pr tr sc sk sm sn sp st sw ch sh th wh").split(" ");
let FOUND = [];                          // extra real words she discovered (shown at the victory screen)
function addFoundWord(w) { if (!FOUND.includes(w)) FOUND.push(w); }
// progress tally, right edge: "3 of 9" — display only (never a gaze target);
// mouse/touch hover reveals the words built so far
function updateTally() {
  // TALLY CHIP REMOVED (dad 7/28): 22px gray at gaze height, unreadable for her,
  // and redundant — the prompt line already says "Word N of M" at readable size.
  // One progress indicator, the readable one. (Kept as a no-op cleaner so all
  // call sites stay valid.)
  const old = document.getElementById("tally");
  if (old) old.remove();
  return;
  /* eslint-disable no-unreachable */
  let t = document.getElementById("tally");
  if (!t) {
    t = document.createElement("div"); t.id = "tally";
    document.body.appendChild(t);
  }
  let done = 0, total = 0;
  if (S.phase === "make") { total = S.lesson.make.length; done = S.wordIdx; }
  else if (S.phase === "sort") { total = sortRemaining().length; done = S.sortIdx; }
  else if (S.phase === "transfer") { total = S.transferStep === 9 ? FL.words.length : (S.spellWords || transferWords()).length; done = S.transferStep === 9 ? FL.idx : S.transferIdx; }
  t.innerHTML = `<div style="font-size:44px;color:var(--teal-deep)">${Math.min(done, total)}</div><div style="font-size:22px">of ${total}</div>`;
  const words = S.phase === "make" ? S.lesson.make.slice(0, S.wordIdx) : [];
  t.title = words.length ? "So far: " + words.join(", ") : "";
  t.style.display = ["make", "sort", "transfer"].includes(S.phase) ? "block" : "none";
}
// phrase catalogs with shuffle-bag rotation: no line repeats until its whole bag
// has been used (her style, statically authored — no LLM per utterance; each line
// becomes a cached mp3 after first play, so variety is free).
function bag(items) {
  let pool = [];
  return () => {
    if (!pool.length) pool = items.slice().sort(() => Math.random() - 0.5);
    return pool.pop();
  };
}
const praiseFast = bag(["So speedy!", "Wow, that was quick!", "Nice looking!", "You smashed it!",
  "Zoom! You knew that one.", "Quick as a fox!", "That was very clear answering."]);
const praisePlain = bag(["Great job!", "Nice reading!", "You did it!", "Beautiful work.",
  "I love how you challenge yourself.", "You're really thinking today.", "That's it!",
  "Yes! Lovely.", "You found it.", "Super spelling."]);
const encourage = bag(["That's okay — let's look together.", "Good try — mistakes help us learn.",
  "Nearly! Let's have another look.", "We'll figure it out together.", "Good thinking — let's check."]);
function praise() {
  const fast = Date.now() - S.lastPromptAt < 6000;
  return fast ? praiseFast() : praisePlain();
}

// ---------- adaptive layout: MAXIMAL sizes for what is actually on screen ----------
// One rule for every row: size = min(cap, avail/(n + (n-1)*gapFrac)); gap = gapFrac*size.
const GAP_FRAC = EC.sizes.gapFrac, GAP_MIN = EC.sizes.gapFloor, SIDE_PAD = EC.sizes.sidePadMakingWords;
function rowFit(n, cap, avail) {
  let size = Math.min(cap, Math.floor(avail / (n + (n - 1) * GAP_FRAC)));
  let gap = Math.floor(size * GAP_FRAC);
  if (gap < GAP_MIN) {   // gap floor beats size: mishit-resistance first (audit #6)
    size = Math.min(cap, Math.floor((avail - (n - 1) * GAP_MIN) / n));
    gap = GAP_MIN;
  }
  return { size, gap };
}
function setVar(k, v) { document.documentElement.style.setProperty(k, v + "px"); }
// Full-bleed keyboard row (dad 7/26): letters split the FULL width — no gaps, no
// side pad. Bold band: 30% of the screen height, constant, flush to the bottom.
// PARK_UNITS reserves the right-end cap for the inert black park pad (ERAgaze
// parks the cursor at the bottom-right corner on track loss — never a target).
const TRAY_BAND = EC.sizes.trayBand, PARK_UNITS = EC.sizes.parkUnits;
function layoutTray(nUnits) {
  const bandH = Math.round(window.innerHeight * TRAY_BAND);
  const unit = Math.floor(window.innerWidth / (nUnits + PARK_UNITS));
  setVar("--trayH", bandH);
  setVar("--letterSize", unit);
  setVar("--parkW", Math.floor(unit * PARK_UNITS));
  setVar("--letterFont", Math.floor(Math.min(unit, bandH) * 0.62));
}
function layoutSlots(len) {
  const { size, gap } = rowFit(len, 190, window.innerWidth - 2 * SIDE_PAD);  // cap 190 (audit #10)
  setVar("--slotW", size); setVar("--slotGap", Math.max(12, gap - 6));
}
function layoutCols(nLive, maxHeadLen) {
  const { size: w, gap } = rowFit(nLive, 460, window.innerWidth - 100);
  const font = Math.min(84, Math.floor((w - 40) / (Math.max(2, maxHeadLen) * 0.62)));  // 0.62: bold glyph width (audit #7)
  setVar("--colW", w); setVar("--colGap", gap); setVar("--colFont", font);
}

// ---------- MAKE phase ----------
function currentWord() { return S.lesson.make[S.wordIdx]; }

// letters carried over from the previous word — tiles stay in the holder
function alignment(prev, w) {
  const empty = new Array(w.length).fill(null);
  if (!prev) return { pre: empty, op: `Use ${w.length} letters to spell ${w}.` };
  const P = prev.toLowerCase(), W = w.toLowerCase();
  if (W.length === P.length + 1) {
    // single insertion at ANY position — her "move the letters over" move (sad->sand)
    for (let i = 0; i < W.length; i++) {
      if (W.slice(0, i) + W.slice(i + 1) === P) {
        const pre = w.split(""); pre[i] = null;
        const op = i === 0 ? `Add a letter at the front to spell ${w}.`
                 : i === W.length - 1 ? `Add a letter at the end to spell ${w}.`
                 : `Move the letters over — we need a letter in here so the word says ${w}.`;
        return { pre, op };
      }
    }
  }
  if (W.length === P.length) {
    // single letter change at ANY position (red->rid: "change the middle letter")
    const diffs = [];
    for (let i = 0; i < W.length; i++) if (W[i] !== P[i]) diffs.push(i);
    if (diffs.length === 1) {
      const i = diffs[0];
      const pre = prev.split(""); pre[i] = null;
      const gone = prev[i];
      const op = i === 0 ? `If we say goodbye to the ${gone}, you can spell ${w}. Change the first letter.`
               : i === W.length - 1 ? `Say goodbye to the ${gone} — change the last letter to spell ${w}.`
               : `Change the middle letter to spell ${w}.`;
      return { pre, op };
    }
    const sorted = s => s.split("").sort().join("");
    if (sorted(W) === sorted(P)) return { pre: empty, op: `Use the same letters — move them around — to spell ${w}.` };
  }
  // non-minimal transition: letters go back, same order every time (her script)
  return { pre: empty, op: `Letters go back — always in A B C order for you. Now use ${w.length} letters to spell ${w}.` };
}

async function startMakeWord() {
  S.phase = "make"; S.fixing = false; S.misses = 0;
  const w = currentWord();
  const prev = S.wordIdx > 0 ? S.lesson.make[S.wordIdx - 1] : null;
  const { pre, op } = alignment(prev, w);
  renderSlotsFrom(w, pre);
  renderModel(null);
  els.cols.style.display = "none";
  els.slots.style.display = "flex";
  const masked = op.replace(new RegExp("\\b" + w.replace(/[.*+?^${}()|[\\]\\\\]/g, "") + "\\b", "gi"), "…").replace(/ to spell …\.?$/, ".");
  els.promptText.textContent = S.tts ? masked : op;
  els.promptSub.textContent = `Word ${S.wordIdx + 1} of ${S.lesson.make.length}`;
  resetNudges();
  log("word_start", { word: w, op, prefilled: pre.filter(Boolean).length });
  await say(op);
  await say(sentenceFor(w));
}

document.addEventListener("dwell:tap-dropped", (e) =>
  log("tap_dropped", e.detail));   // dropped presses are VISIBLE, never silent (7/28)
document.addEventListener("dwell:tap-rescued", (e) =>
  log("tap_rescued", e.detail));   // long presses Windows abandoned, delivered by the engine

function renderStartSub() {
  const parts = S.lesson.letters.map(L =>
    "aeiou".includes(L.toLowerCase()) ? `<span class="sv">${L}</span>` : L);
  $("startSub").innerHTML = `Today: letters ${parts.join(" · ")}`;
}

async function pickLetter(L) {
  if (S.paused) return;
  // COMPLETED-TASK WINDOW (dad 7/28): once the word is done, letter taps are
  // fully INERT until the next word is offered — no barge-in, no echo, no
  // noise. (Barge-in still applies to meaningful actions, not dead-window taps.)
  if (S.transitioning) return;
  if (S.mistakeHold && S.finishMistake) S.finishMistake();  // she jumped in: accept it (dad 7/28)
  if (window.Speech) Speech.stop();   // barge-in: her action interrupts our audio
  const spelling = S.phase === "make" || S.phase === "secret" ||
                   (S.phase === "transfer");
  if (!spelling) return;
  const w = targetWordNow();
  const i = firstEmpty();
  if (i === -1) return;
  S.attempt[i] = L;
  const slot = els.slots.children[i];
  slot.textContent = L; slot.classList.add("filled"); slot.classList.remove("check");
  log("letter", { letter: L, pos: i, word: w, fixing: S.fixing,
                  sincePrompt: Date.now() - S.lastPromptAt });
  say(nameSound(L), { kind: "letter" });
  // her per-letter look-back cue during transfer ("use what you know to help you")
  if (S.phase === "transfer" && !isComplete() && i === 0)
    say("Now look back — copy what you already know.");
  if (isComplete()) await checkAttempt(w);
}

function unpickLetter() {
  if (S.paused || S.transitioning) return;
  if (window.Speech) Speech.stop();
  // clear the LAST filled slot that is not locked
  for (let i = S.attempt.length - 1; i >= 0; i--) {
    if (S.attempt[i] !== null && !S.locked[i]) {
      S.attempt[i] = null;
      const slot = els.slots.children[i];
      slot.textContent = ""; slot.classList.remove("filled");
      log("backspace", { pos: i });
      return;
    }
  }
}

async function checkAttempt(w) {
  const got = S.attempt.join("");
  const ok = got.toLowerCase() === w.toLowerCase();
  if (!ok && S.phase !== "secret") S.misses++;
  log("attempt", { word: w, got, ok, phase: S.phase, fixing: S.fixing, misses: S.misses });
  if (ok) {
    for (const s of els.slots.children) { s.classList.add("match"); s.classList.remove("check", "locked"); }
    // CELEBRATE-THEN-ADVANCE (dad 7/28): the screen HOLDS the completed word
    // while the voice celebrates it — the next word appears only after the
    // sentence ends. Her own action still barges in (stop() resolves the chain).
    confetti(6);
    S.transitioning = true;
    try {
      await say(`${soundOut(w)} — ${w}! ${praise()}`);
      await pause(350);
    } finally { S.transitioning = false; }
    return advance();
  }
  if (S.phase === "secret") return revealSecret(true);
  // RENDER THE MISTAKE FIRST (dad 7/28): her letters STAY on screen while the
  // voice talks about them — wrong ones calmly marked (never an X, no buzzer).
  // Only after the mistake line does compare-and-fix replace them. A tap during
  // the hold fast-forwards the transition and is accepted normally.
  const keep = [];
  for (let i = 0; i < w.length; i++) {
    keep.push(S.attempt[i] && S.attempt[i].toLowerCase() === w[i].toLowerCase() ? w[i] : null);
  }
  for (let i = 0; i < w.length; i++) {
    if (!keep[i]) els.slots.children[i].classList.add("miss");
  }
  S.mistakeHold = true;
  // TWO-STRIKE REVEAL (dad 8/9, D50): the first miss never shows the answer.
  const firstMiss = S.misses === 1;
  S.finishMistake = () => {
    if (!S.mistakeHold) return;
    S.mistakeHold = false;
    S.fixing = true;
    renderSlotsFrom(w, keep);
    for (let i = 0; i < w.length; i++) {
      if (!keep[i]) els.slots.children[i].classList.add("check");
    }
    // Strike one leaves the model row alone (empty in make; in transfer the
    // rhyme-model scaffold stays — only the ANSWER is withheld). Strike two
    // brings the model word for compare-and-fix.
    if (!firstMiss) renderModel(w);
    resetNudges();
  };
  const gotWord = got.toLowerCase();
  if (isRealWord(gotWord) && gotWord !== w.toLowerCase()) {
    // the "haz" move: an unintended real word gets a quick celebration (speech only)
    log("found_word", { word: gotWord, target: w });
    addFoundWord(gotWord);
    await say(`${gotWord}! That's a real word too — I like it. Now, ${w}:`);
  } else {
    await say(`${soundOut(gotWord)} — hmm. ${encourage()}`);
  }
  S.finishMistake();   // mistake was seen AND heard; now show the fix view
  if (firstMiss) {
    // Strike one, her literacy specialist's way: her correct letters stay locked on screen, the
    // voice says the word, sounds it out, and leans on the sound(s) she's
    // missing — no model, no spell-out. She retries; a second miss reveals.
    const kept = w.split("").filter((_, i) => keep[i]);
    const missing = [...new Set(w.toLowerCase().split("").filter((_, i) => !keep[i]).map(c => SOUNDS[c] || c))];
    const have = kept.length ? ` You already have the ${kept.join(" and the ")} — keep them.` : "";
    const listen = missing.length ? ` Listen for the ${missing.join(", and the ")}.` : "";
    await say(`Remember, the word is ${w}.${have} ${soundOut(w)} — ${w}.${listen} Try again!`);
  } else {
    await say(`Let's check together. Look — ${spellOut(w)} spells ${w}. Fill in the missing letters.`);
  }
  // she fills the dashed slots; completion re-checks; phase and indexes untouched
  // (works identically in make and transfer — the review's P0-1)
}

const SECRET_MODE = !!(window.StudioConfig && window.StudioConfig.secretWord);  // her literacy specialist doesn't use the reveal ritual
async function advance() {
  renderModel(null);
  if (S.phase === "transfer") return advanceTransfer();
  if (S.phase === "secret") return revealSecret(false);
  S.wordIdx++;
  if (SECRET_MODE) {
    if (S.wordIdx < S.lesson.make.length - 1) return startMakeWord();
    if (S.wordIdx === S.lesson.make.length - 1) return startSecret();
  } else {
    if (S.wordIdx < S.lesson.make.length) {
      if (S.wordIdx === S.lesson.make.length - 1)
        say("Last word — the BIG one. It uses all of your letters!");
      return startMakeWord();   // the final word gets her normal move-the-letters scaffold
    }
  }
  return makeRecapThenBreak();
}

// her end-of-make ritual: the completed ladder rendered TOP-TO-BOTTOM like a
// finished shopping list, retold as a story, then the break choice
async function makeRecapThenBreak() {
  const words = S.lesson.make.map(w => w.split("/")[0].trim());
  log("make_recap", { words });
  // render FIRST (she looks at the list while it's read), speak after
  show("sBig");
  els.bigTitle.textContent = "Look at everything you spelt!";
  els.bigWord.textContent = "";
  els.bigWord.style.display = "none";
  els.bigSub.textContent = FOUND.length ? "✦ bonus words you found: " + FOUND.join(" · ") : "";
  let list = document.getElementById("bigList");
  if (!list) {
    list = document.createElement("div"); list.id = "bigList";
    els.bigSub.parentNode.insertBefore(list, els.bigSub);
  }
  // 2-COLUMN WALL (dad 7/28): fill the screen, readable at distance — words in
  // two columns with real separation, font at/above the 74px floor when it fits.
  const rows = Math.ceil(words.length / 2);
  // budget: 1080 - screen padding - title - bonus line - buttons - gaps ≈ 500px
  // for the list. Words here are READ-ALONG recall, not gaze targets — so long
  // lists may sit between the 46px reading floor and the 74px tile floor;
  // short lists scale up to 88.
  const fs = Math.max(56, Math.min(88, Math.floor(500 / (rows * 1.25))));
  list.style.cssText = "display:grid;grid-auto-flow:column;grid-template-rows:repeat(" + rows +
    ",auto);column-gap:clamp(90px,11vw,180px);row-gap:" + Math.max(6, Math.floor(fs * 0.10)) +
    "px;font-weight:650;color:var(--ink);justify-content:center";
  list.innerHTML = "";
  words.forEach((w, i) => {
    const row = document.createElement("div");
    const last = i === words.length - 1;
    row.style.cssText = "font-size:" + (last ? Math.floor(fs * 1.25) : fs) + "px;line-height:1.15;" +
      (last ? "color:var(--teal-deep);font-weight:750;" : "");
    row.innerHTML = '<span style="color:var(--good);margin-right:16px">✓</span>' + w;
    list.appendChild(row);
  });
  say(`Look at everything you spelt today: ${words.join(", ")}. Little words helped you spell the big word — ${words[words.length - 1]}!`);
  confetti(14);
  els.bigRow.innerHTML = "";
  const go = document.createElement("div");
  go.className = "action primary dwell"; go.setAttribute("data-dwell-ms", String(EC.holds.answer));
  go.textContent = "Keep going ▶";
  go.addEventListener("click", () => { if (window.Speech) Speech.stop(); log("break_choice", { choice: "go" }); if (S.part === "make") return endLesson(); show("stage"); startSort(); });
  const rest = document.createElement("div");
  rest.className = "action dwell"; rest.setAttribute("data-dwell-ms", String(EC.holds.answer));
  rest.textContent = "Rest 🌙";
  rest.addEventListener("click", async () => {
    if (window.Speech) Speech.stop();          // barge-in: cut the recap narration NOW
    rest.textContent = "Resting… 🌙";           // instant visible response (dad 7/28)
    rest.style.borderColor = "var(--teal)";
    log("break_choice", { choice: "rest" });
    await say("Let's rest. Move about if you like! Look at Keep Going whenever you're ready.");
  });
  els.bigRow.appendChild(go); els.bigRow.appendChild(rest);
  resetNudges();
  await say("Would you like to keep going to sorting, or rest first?");
}

// ---------- SECRET WORD ----------
async function startSecret() {
  S.phase = "secret"; S.fixing = false; S.misses = 0;
  const w = secretWord();
  renderSlotsFrom(w, null); renderModel(null);
  els.promptText.textContent = "The SECRET word uses ALL your letters!";
  els.promptSub.textContent = S.tts ? "What could it be?" : `It starts with ${w[0]}…`;
  resetNudges();
  log("secret_start", { word: w });
  await say("Now for the secret word! It uses ALL of your letters. What could it be? Take your time.");
}
async function revealSecret(supported) {
  const w = secretWord();
  show("sBig");
  els.bigTitle.textContent = "The secret word is…";
  els.bigWord.textContent = w;
  els.bigSub.textContent = sentenceFor(w);
  confetti(14);
  log("secret_reveal", { word: w, solvedAlone: !supported });
  await say(`The secret word is ${w}! ${spellOut(w)} — ${w}. ${sentenceFor(w)}`);
  // Her choice, not a timer (the reveal is the natural break point):
  els.bigRow.innerHTML = "";
  const go = document.createElement("div");
  go.className = "action primary dwell"; go.setAttribute("data-dwell-ms", String(EC.holds.answer));
  go.textContent = "Keep going ▶";
  go.addEventListener("click", () => { if (window.Speech) Speech.stop(); log("break_choice", { choice: "go" }); if (S.part === "make") return endLesson(); show("stage"); startSort(); });
  const rest = document.createElement("div");
  rest.className = "action dwell"; rest.setAttribute("data-dwell-ms", String(EC.holds.answer));
  rest.textContent = "Rest 🌙";
  rest.addEventListener("click", async () => {
    if (window.Speech) Speech.stop();
    rest.textContent = "Resting… 🌙";
    rest.style.borderColor = "var(--teal)";
    log("break_choice", { choice: "rest" });
    await say("Let's rest. Look at Keep Going whenever you're ready. No hurry at all.");
  });
  els.bigRow.appendChild(go); els.bigRow.appendChild(rest);
  resetNudges();
  await say("Would you like to keep going, or rest?");
}

// ---------- SORT phase ----------
function rimeKey(x) { const m = x.toLowerCase().match(/[aeiou].*$/); return m ? m[0] : x.toLowerCase(); }
// Columns for the CHOSEN sort type — the lesson's own if it matches, else derived
// from the make words (both exercises are valid on any set; her toggle).
function buildSortCols(type) {
  const words = S.lesson.make.map(w => w.split("/")[0].trim());
  if (type === "first-letter") {
    // native first-letter columns already cover every made word; else derive by initial
    if (S.lesson.sort.type !== "rhyme") return S.lesson.sort.columns;
    const g = {};
    for (const w of words) (g[w[0].toLowerCase()] = g[w[0].toLowerCase()] || []).push(w);
    return Object.values(g);
  }
  // RHYME: always derive richly — the book's printed rhyme columns list only
  // head + one example (L44: sir/stir, it/sit = 2 sortable). Her literacy specialist sorts every
  // made word, so: families from the FULL make list, topped up with the lesson's
  // transfer words (they rhyme by design) and real derived family words, until
  // there's a proper session (>=6 sortable, cap ~9).
  const g = {};
  for (const w of words) (g[rimeKey(w)] = g[rimeKey(w)] || []).push(w);
  let cols = Object.values(g).filter(c => c.length >= 2);
  if (!cols.length) return S.lesson.sort.columns;   // pathological set: fall back
  const inCols = new Set(cols.flat().map(w => w.toLowerCase()));
  let sortable = cols.reduce((n, c) => n + c.length - 1, 0);
  const addTo = (w) => {
    const col = cols.find(c => rimeKey(c[0]) === rimeKey(w));
    if (col && !inCols.has(w.toLowerCase())) { col.push(w); inCols.add(w.toLowerCase()); sortable++; return true; }
    return false;
  };
  // 1) the lesson's own transfer words — smallest families first, so one big
  //    family can't dominate the sequence
  const t = S.lesson.transfer;
  const byNeed = (t && t.type === "words" && t.words || []).slice()
    .sort((a, b) => {
      const size = w => (cols.find(c => rimeKey(c[0]) === rimeKey(w)) || []).length;
      return size(a) - size(b);
    });
  for (const w of byNeed) { if (sortable >= 9) break; addTo(w); }
  // 2) real derived family words (onset + rime, dictionary-checked)
  if (sortable < 6) {
    outer: for (let round = 0; round < 3; round++) {
      for (const col of cols) {
        if (sortable >= 8) break outer;
        const rime = rimeKey(col[0]);
        for (const o of ONSETS) {
          const cand = o + rime;
          if (!inCols.has(cand) && isRealWord(cand)) { addTo(cand); break; }
        }
      }
    }
  }
  // heads = shortest word of each family (the model she reads against)
  for (const col of cols) col.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return cols;
}
function sortColumns() { return S.sortCols || S.lesson.sort.columns; }
function isFirstLetterSort() { return (S.sortType || (S.lesson.sort.type === "rhyme" ? "rhyme" : "first-letter")) === "first-letter"; }
// first-letter sorts: heads are the LETTERS (her pink post-its) and EVERY word is
// sorted, including former head-words. Rhyme sorts keep word heads (webinar slide).
function liveColumns() {
  if (isFirstLetterSort()) return sortColumns().map((c, i) => ({ c, i }));
  return sortColumns().map((c, i) => ({ c, i })).filter(x => x.c.length >= 2);
}
function sortHeads() {
  if (isFirstLetterSort()) return sortColumns().map(c => c[0][0].toLowerCase());
  return sortColumns().map(c => c[0]);
}
let sortSeq = null;
function sortRemaining() {
  if (sortSeq) return sortSeq;
  const cols = sortColumns().map((c, ci) => (isFirstLetterSort() ? c : c.slice(1)).map(w => ({ w, ci })));
  // easier first (shorter words), then interleave columns so the answer never
  // telegraphs itself by position; light shuffle inside each tier
  const flat = cols.flat();
  flat.sort((a, b) => a.w.length - b.w.length || Math.random() - 0.5);
  const seq = [];
  while (flat.length) {
    let pick = flat.findIndex(x => seq.length < 2 || !(x.ci === seq[seq.length - 1].ci && x.ci === seq[seq.length - 2].ci));
    if (pick === -1) pick = 0;                     // only one column left — allow the run
    seq.push(flat.splice(pick, 1)[0]);
  }
  sortSeq = seq.map(x => x.w);
  return sortSeq;
}

let headEls = [];        // dwell heads for LIVE columns only
let colElByIdx = {};     // original column index -> its .col element

// sort-type chooser: first letter (simpler) vs rhyme (more complex) — both valid
async function chooseSortType() {
  return new Promise(res => {
    const native = S.lesson.sort.type === "rhyme" ? "rhyme" : "first-letter";
    show("sBig");
    els.bigTitle.textContent = "How shall we sort?";
    els.bigWord.textContent = "";
    els.bigSub.textContent = "";
    els.bigRow.innerHTML = "";
    const mk = (label, type) => {
      const d = document.createElement("div");
      d.className = "action dwell" + (type === native ? " primary" : "");
      // deliberate: reading a card must not select it (gaze passes over these to read)
      d.setAttribute("data-dwell-ms", String(EC.holds.exit));
      d.textContent = label + (type === native ? " ★" : "");
      d.addEventListener("click", () => { if (window.Speech) Speech.stop(); log("sort_type_choice", { type }); res(type); });
      return d;
    };
    els.bigRow.appendChild(mk("First letter", "first-letter"));
    els.bigRow.appendChild(mk("Rhyme", "rhyme"));
    resetNudges();
    say("How shall we sort your words today? By their first letter, or by rhyme? The star shows today's lesson.");
  });
}

async function startSort(forTransfer) {
  if (!forTransfer && !S.sortType) {
    S.sortType = await chooseSortType();
    S.sortCols = buildSortCols(S.sortType);
    show("stage");
  } else if (forTransfer) {
    // transfer always uses the lesson's native columns (models come from them)
    S.sortType = S.lesson.sort.type === "rhyme" ? "rhyme" : "first-letter";
    S.sortCols = S.lesson.sort.columns;
  }
  S.phase = "sort"; S.sortIdx = 0; sortSeq = null;
  els.slots.style.display = "none"; els.model.innerHTML = ""; els.tray.innerHTML = "";
  els.sortwordWrap.innerHTML = "";
  els.cols.style.display = "none"; els.cols.innerHTML = "";
  headEls = []; colElByIdx = {};
  const live = new Set(liveColumns().map(x => x.i));
  // BOTTOM SORT TRAY (dad 7/28): the selection heads live in the full-bleed
  // bottom row — the SAME motor plan as the letter tray and TD Snap's bottom
  // rows — and each column's sorted words stack ABOVE its head. Shared with the
  // first-letter transfer screen via buildChoiceTray (one pick-a-column motor plan).
  const liveIdxs = sortColumns().map((c, i) => i).filter(i => live.has(i));
  const labels = liveIdxs.map(idx => {
    const col = sortColumns()[idx];
    return isFirstLetterSort() ? col[0][0].toLowerCase() : col[0];
  });
  $("stage").classList.add("choosing");   // pill rides high; stacks own the field
  const built = buildChoiceTray(labels, (k) => onHeadActivate(liveIdxs[k]), 1600);
  headEls = built.heads;
  liveIdxs.forEach((idx, k) => { colElByIdx[idx] = built.stacks[k]; });
  // words that head a column nothing sorts into: small reference chips, not giant targets
  let also = document.getElementById("alsoMade");
  if (!also) { also = document.createElement("div"); also.id = "alsoMade"; els.cols.parentNode.insertBefore(also, els.cols); }
  also.innerHTML = "";
  const deadWords = [];
  sortColumns().forEach((col, idx) => { if (!live.has(idx)) deadWords.push(col[0]); });
  if (deadWords.length) {
    const label = document.createElement("span"); label.textContent = "you also made:";
    also.appendChild(label);
    for (const dw of deadWords) {
      const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = dw;
      also.appendChild(chip);
    }
  }
  const w = document.createElement("div"); w.id = "sortword"; els.sortwordWrap.appendChild(w);
  if (forTransfer) {   // transfer-only day: columns arrive pre-sorted as reference
    sortColumns().forEach((col, idx) => {
      if (!colElByIdx[idx]) return;
      for (const cw of col.slice(1)) {
        const d = document.createElement("div"); d.className = "colword"; d.textContent = cw;
        colElByIdx[idx].appendChild(d);
      }
    });
    log("sort_prefilled", {});
    return startTransfer();
  }
  const byRhyme = !isFirstLetterSort();          // the CHOSEN type, always
  els.promptText.textContent = byRhyme ? "Sort the words by rhyme" : "Sort the words by first letter";
  els.promptSub.textContent = "";
  let chip = document.getElementById("sortMethod");
  if (!chip) { chip = document.createElement("div"); chip.id = "sortMethod"; els.sortwordWrap.parentNode.insertBefore(chip, els.sortwordWrap); }
  chip.style.display = "";
  chip.textContent = byRhyme ? "RHYME — words that sound the same at the end"
                             : "FIRST LETTER — words that start the same";
  log("sort_start", { chosen: S.sortType, native: S.lesson.sort.type, columns: sortColumns() });
  await say(byRhyme ? "Now let's sort by rhyme! Put the words that sound the same at the end together."
                    : "Now let's sort by the first letter! Put the words that start the same together.");
  nextSortWord();
}

// single dispatcher — heads are created ONCE and never cloned (review P1-4)
function onHeadActivate(idx) {
  if (S.paused) return;
  if (S.phase === "sort") return pickColumn(idx);
}

function currentSortWord() { return sortRemaining()[S.sortIdx]; }
async function nextSortWord() {
  const w = currentSortWord();
  if (!w) return sortRecapThenTransfer();
  $("sortword").textContent = w;
  els.promptSub.textContent = `Word ${S.sortIdx + 1} of ${sortRemaining().length} — read it in your head. Where does it belong?`;
  resetNudges();
  // SILENT READING TASK — never speak the word before she sorts it (part2 video).
  // Non-blocking: she can answer while (or instead of) listening.
  say("Here's your next word. Read it in your head. Where does it belong?");
}
let pickLock = false;
async function pickColumn(idx) {
  if (pickLock || S.transitioning) return;                       // re-entrancy: one decision at a time
  const w = currentSortWord(); if (!w) return;
  if (window.Speech) Speech.stop();           // barge-in
  pickLock = true;
  setTimeout(() => { pickLock = false; }, 350);
  const heads = sortHeads();
  const correctIdx = isFirstLetterSort()
    ? sortColumns().findIndex(c => c[0][0].toLowerCase() === w[0].toLowerCase())   // match by first letter (head words sort too)
    : sortColumns().findIndex(c => c.slice(1).map(x => x.toLowerCase()).includes(w.toLowerCase()));
  const ok = idx === correctIdx;
  log("sort_pick", { word: w, picked: heads[idx], ok, sincePrompt: Date.now() - S.lastPromptAt });
  if (ok) {
    const word = document.createElement("div"); word.className = "colword"; word.textContent = w;
    (colElByIdx[idx] || els.cols.children[0]).appendChild(word);
    // CELEBRATE-THEN-ADVANCE (dad 7/28): finish the read-together line, THEN
    // show the next word. transitioning guards taps during the celebration.
    S.sortIdx++;
    S.transitioning = true;
    try {
      if (isFirstLetterSort())
        await say(`${soundOut(w)} — ${w}! ${w} begins with ${nameSound(w[0])}. ${praise()}`);
      else
        await say(`${soundOut(w)} — ${w}! They rhyme! ${praise()}`);
      return nextSortWord();
    } finally { S.transitioning = false; }
  }
  if (isFirstLetterSort()) {
    const picked = heads[idx];
    if (w.toLowerCase().includes(picked))
      say(`There IS a ${picked} in this word — good spotting! But it's not the first letter. Where does it belong?`);
    else
      say(`${encourage()} Look at the very first letter. Where does it belong?`);
  } else {
    say(`Hmm — does your word sound the same at the end as ${heads[idx]}? Try another one.`);
  }
  resetNudges();
}

async function sortRecapThenTransfer() {
  // her end-of-sort ritual: read each column back as a family
  for (const { c } of liveColumns()) {
    const words = isFirstLetterSort() ? c : c;
    if (isFirstLetterSort())
      await say(`You found ${words.length === 1 ? "a word" : words.length + " words"} beginning with ${nameSound(c[0][0])}: ${words.join(", ")}.`);
    else
      await say(`${words.join(", ")} — they all rhyme!`);
  }
  startTransfer();
}

// ---------- TRANSFER phase ----------
function transferWords() {
  const t = S.lesson.transfer;
  const book = (t && t.words && t.words.length && t.type === "words") ? t.words.slice(0, 4) : [];
  if (!book.length) return book;
  // top up with real derived family words to a 5-word session (his spec: 4-6)
  const have = new Set(book.map(w => w.toLowerCase()));
  const extra = deriveFamilyWords().filter(w => !have.has(w.toLowerCase()));
  return book.concat(extra).slice(0, 5);
}
// derive brand-new rhyming words for the family-spell exercise (part3b: at->cat):
// take the make-words' rhyme families, prefix single onsets, keep real words only
function deriveFamilyWords() {
  // group the make list itself (NOT the sort columns, which drop one-word
  // families) — a singleton like "an" still gives her can/man/fan, the method's
  // at->cat move. Richer families lead so variety comes first.
  const g = {};
  for (const w of S.lesson.make.map(x => x.split("/")[0].trim())) {
    (g[rimeKey(w)] = g[rimeKey(w)] || []).push(w);
  }
  const fams = Object.values(g).sort((a, b) => b.length - a.length);
  const known = new Set(S.lesson.make.map(w => w.split("/")[0].trim().toLowerCase()));
  const out = [];
  for (let round = 0; round < 4 && out.length < 6; round++) {
    for (const fam of fams) {
      if (out.length >= 6) break;
      const rime = rimeKey(fam[0]);
      for (const o of ONSETS) {
        const cand = o + rime;
        if (!known.has(cand) && !out.includes(cand) && isRealWord(cand)) { out.push(cand); break; }
      }
    }
  }
  return out;
}
// early lessons: HER transfer is first-letter identification with real classroom
// words (part3 video) — the data has the words, use them
function firstLetterWords() {
  const t = S.lesson.transfer;
  if (!t || !t.words || !t.words.length || t.type === "words") return [];
  const letters = new Set(S.lesson.letters.map(l => l.toLowerCase()));
  return t.words.filter(w => letters.has(w[0].toLowerCase())).slice(0, 10);   // 6-10 (his spec)
}
function currentTransferWord() { return (S.spellWords || transferWords())[S.transferIdx]; }

// transfer-type chooser: first letter (simpler) vs spell new words (at -> cat)
async function chooseTransferType() {
  return new Promise(res => {
    const native = (S.lesson.transfer && S.lesson.transfer.type === "words") ? "spell" : "first-letter";
    show("sBig");
    els.bigTitle.textContent = "Transfer time!";
    els.bigWord.textContent = "";
    els.bigSub.textContent = "";
    els.bigRow.innerHTML = "";
    const mk = (label, type) => {
      const d = document.createElement("div");
      d.className = "action dwell" + (type === native ? " primary" : "");
      d.setAttribute("data-dwell-ms", String(EC.holds.exit));
      d.textContent = label + (type === native ? " ★" : "");
      d.addEventListener("click", () => { if (window.Speech) Speech.stop(); log("transfer_type_choice", { type }); res(type); });
      return d;
    };
    els.bigRow.appendChild(mk("First letter", "first-letter"));
    els.bigRow.appendChild(mk("Spell new words", "spell"));
    resetNudges();
    say("Transfer time! Shall we find first letters, or spell whole new words? The star shows today's lesson.");
  });
}

async function startTransfer() {
  if (S.part === "sort") return endLesson();     // sort-only day ends here
  if (!S.transferType) { S.transferType = await chooseTransferType(); show("stage"); }
  if (S.transferType === "first-letter") {
    let flw = firstLetterWords().length ? firstLetterWords()
            : (transferWords().length ? transferWords() : deriveFamilyWords());
    if (flw.length && flw.length < 6) {                 // aim 6-10
      const have = new Set(flw.map(w => w.toLowerCase()));
      for (const w of deriveFamilyWords()) if (!have.has(w.toLowerCase())) { flw.push(w); have.add(w.toLowerCase()); }
      // last resort: sprinkle in made words she knows (still first-letter practice)
      for (const w of S.lesson.make.map(x => x.split("/")[0].trim())) {
        if (flw.length >= 6) break;
        if (!have.has(w.toLowerCase())) { flw.push(w); have.add(w.toLowerCase()); }
      }
      flw = flw.slice(0, 10);
    }
    if (flw.length) return startFirstLetterTransfer(flw);
    return endLesson();
  }
  // spell mode: the lesson's words, or derived family words for early lessons
  const words = transferWords().length ? transferWords() : deriveFamilyWords();
  S.spellWords = words;
  if (!words.length) {
    // no usable words at all: real-world partner activity placard
    const t = S.lesson.transfer || {};
    const hint = t.detail || "Find things in the room that begin with your letters!";
    log("transfer_realworld", { detail: hint });
    show("sBig");
    els.bigTitle.textContent = "Transfer time — in the real world!";
    els.bigWord.textContent = S.lesson.letters.join(" ");
    els.bigSub.textContent = hint;
    els.bigRow.innerHTML = "";
    const done = document.createElement("div");
    done.className = "action primary dwell"; done.setAttribute("data-dwell-ms", String(EC.holds.answer));
    done.textContent = "All done ▶";
    done.addEventListener("click", () => { show("stage"); endLesson(); });
    els.bigRow.appendChild(done);
    await say("Transfer time! This part happens in the real world. " + hint + " Your grown-up will play with you!");
    return;
  }   // early lessons transfer to objects/pictures — done live w/ partner
  S.phase = "transfer"; S.transferIdx = 0;
  els.cols.style.display = "none";            // clean transfer screen — no sort columns
  const sw = $("sortword"); if (sw) sw.style.display = "none";
  const sm = $("sortMethod"); if (sm) sm.style.display = "none";
  els.promptText.textContent = "New words — you can spell them!";
  log("transfer_start", { words });
  await say("Now the best part. Brand new words — and you already know how to spell them!");
  transferOne();
}

// ---- first-letter transfer (part3 video): hear a word + its context, find its
// first letter among the lesson letters; the word lands in that letter's column ----
const FL = { idx: 0, cols: {}, words: [], letters: [] };
async function startFirstLetterTransfer(wordList) {
  S.phase = "transfer"; S.transferStep = 9;   // 9 = first-letter mode
  FL.idx = 0; FL.cols = {};
  FL.words = wordList || firstLetterWords();
  const lessonLetters = S.lesson.letters.map(l => l.toLowerCase());
  const firsts = [...new Set(FL.words.map(w => w[0].toLowerCase()))];
  FL.letters = firsts.every(f => lessonLetters.includes(f)) ? lessonLetters : firsts.sort();
  els.cols.style.display = "none"; els.cols.innerHTML = "";     // no floating columns — bottom tray now
  els.slots.style.display = "none"; renderModel(null);
  els.sortwordWrap.innerHTML = "";
  const also = document.getElementById("alsoMade"); if (also) also.innerHTML = "";
  const sm = document.getElementById("sortMethod"); if (sm) sm.style.display = "none";
  const sw = document.getElementById("sortword"); if (sw) sw.style.display = "none";
  // BOTTOM CHOICE TRAY (dad 7/28): one letter-head per lesson letter in the
  // full-bleed bottom band (her whiteboard columns, now motor-consistent with
  // sort + make + TD Snap); each word she places stacks ABOVE its letter. Shared
  // pick-a-column implementation with sort (buildChoiceTray).
  const letters = FL.letters;
  $("stage").classList.add("choosing");
  const built = buildChoiceTray(letters, (k) => flPick(k), 1600);
  headEls = built.heads; colElByIdx = {};
  letters.forEach((L, idx) => { colElByIdx[idx] = built.stacks[idx]; });
  els.promptText.textContent = "New words! Which letter do they start with?";
  els.promptSub.textContent = "";
  log("transfer_firstletter_start", { words: FL.words });
  await say("Now for new words — words from the real world! Listen, and find the letter each one starts with.");
  flNext();
}
async function flNext() {
  const w = FL.words[FL.idx];
  if (!w) return endLesson();
  els.promptSub.textContent = `Word ${FL.idx + 1} of ${FL.words.length} — listen… which letter does it start with?`;
  resetNudges();
  log("transfer_fl_word", { word: w });
  say(`${w}. ${sentenceFor(w)} Which letter does ${w} start with?`);
}
async function flPick(idx) {
  if (S.paused || S.transferStep !== 9) return;
  if (pickLock || S.transitioning) return;
  if (window.Speech) Speech.stop();
  pickLock = true; setTimeout(() => { pickLock = false; }, 350);
  const w = FL.words[FL.idx];
  const letters = FL.letters;
  const ok = letters[idx] === w[0].toLowerCase();
  log("transfer_fl_pick", { word: w, picked: letters[idx], ok });
  if (ok) {
    const d = document.createElement("div"); d.className = "colword"; d.textContent = w;
    colElByIdx[idx].appendChild(d);
    FL.idx++;
    // CELEBRATE-THEN-ADVANCE (dad 7/28)
    S.transitioning = true;
    try {
      await say(`${nameSound(w[0])} — ${w}! ${praise()}`);
      return flNext();
    } finally { S.transitioning = false; }
  }
  if (w.toLowerCase().includes(letters[idx]))
    say(`There IS a ${letters[idx]} in ${w} — good spotting! But listen to the FIRST sound: ${SOUNDS[w[0].toLowerCase()] || w[0]}… ${w}.`);
  else
    say(`Listen to the first sound: ${SOUNDS[w[0].toLowerCase()] || w[0]}… ${w}. Which letter makes that sound?`);
  resetNudges();
}

// Her literacy specialist's transfer: show a MODEL word she already made (e.g. "ram"), then have
// her spell a NEW rhyming word (e.g. "jam") letter-by-letter with the model visible.
// SHOW_TRANSFER_MODEL fades the support to false later (config-tunable).
const SHOW_TRANSFER_MODEL = (window.StudioConfig && window.StudioConfig.transferModel === false) ? false : true;
function rimeOf(x) { const m = x.toLowerCase().match(/[aeiou].*$/); return m ? m[0] : x.toLowerCase(); }
function modelFor(w) {
  const r = rimeOf(w);
  const pools = [buildSortCols("rhyme"), S.lesson.sort.type === "rhyme" ? S.lesson.sort.columns : []];
  for (const pool of pools) for (const col of pool) {
    // a model must ITSELF rhyme with the target — never just share a column
    const cands = col.filter(x => rimeOf(x) === r && x.toLowerCase() !== w.toLowerCase());
    if (cands.length) { cands.sort((a, b) => b.length - a.length); return cands[0]; }
  }
  return null;
}

async function transferOne() {
  const w = currentTransferWord();
  if (!w) return endLesson();
  S.transferStep = 1; S.fixing = false; S.misses = 0;
  const model = SHOW_TRANSFER_MODEL ? modelFor(w) : null;
  renderModel(model);                          // the "can" she keeps looking at while spelling "fan"
  // letters she needs first, then the rest of the lesson set (capped for the rest corridor)
  const need = [...new Set(w.toLowerCase().split(""))];
  const extra = S.lesson.letters.map(l => l.toLowerCase()).filter(l => !need.includes(l));
  const trayLetters = [...need, ...extra].slice(0, Math.max(need.length, 8)).sort();  // ALPHABETICAL — never leak the answer order
  buildTray(trayLetters, true);
  renderSlotsFrom(w, null);
  els.slots.style.display = "flex";
  els.promptText.textContent = S.tts ? "Spell the word you hear" : `Spell ${w}`;
  // progress lives in the prompt line (pattern rule 4) — never a separate chip
  const tcount = (S.spellWords || transferWords()).length;
  const prog = `Word ${S.transferIdx + 1} of ${tcount}`;
  els.promptSub.textContent = model
    ? (S.tts ? `${prog} — it rhymes with ${model}` : `${prog} — ${w} rhymes with ${model}`)
    : prog;
  resetNudges();
  log("transfer_word", { word: w, model });
  await say(model
    ? `I'll let you into a secret: you only need to think about the FIRST sound of ${w} — after that, you can copy what you already know from ${model}. ${sentenceFor(w)} Ready? Spell ${w}.`
    : `Now spell ${w}. ${sentenceFor(w)}`);
}

async function advanceTransfer() {
  S.transferIdx++;
  renderModel(null);
  if (S.transferIdx < (S.spellWords || transferWords()).length) return transferOne();
  endLesson();
}

// ---------- end / rating ----------
async function endLesson() {
  S.phase = "end"; S.rated = false;
  $("adultBar").style.display = "flex";   // back for the adult between sessions
  document.querySelectorAll("#sEnd .action").forEach(a => a.removeAttribute("data-dwell-disabled"));
  show("sEnd");
  $("endNote").textContent = "";
  log("lesson_end", { lesson: S.lesson.lesson });
  resetNudges();
  await say("You did it! A whole lesson. How was that for you?");
}
document.querySelectorAll("#sEnd .action").forEach(a => {
  a.addEventListener("click", async () => {
    if (S.rated) return;
    S.rated = true;
    document.querySelectorAll("#sEnd .action").forEach(x => x.setAttribute("data-dwell-disabled", ""));
    const r = a.dataset.rate;
    log("self_rating", { rating: r });
    $("endNote").textContent = "Thank you for telling me! 💛";
    await say(r === "easy" ? "Too easy! I'll find you something trickier."
            : r === "hard" ? "That was tricky. That's okay — tricky means you're learning."
            : "Just right. You're amazing.");
    confetti(18);
  });
});

// ---------- gentle nudge loop (wait time sacred; never advances anything) ----------
setInterval(() => {
  if (S.paused || !["make", "sort", "transfer", "secret"].includes(S.phase)) return;
  const idle = Date.now() - S.lastPromptAt;
  if (idle < 45000) return;
  if (S.nudges === 0) {
    S.nudges = 1; S.lastPromptAt = Date.now();
    log("nudge", { n: 1 });
    say(S.phase === "sort" ? "Take your time. Where does it belong?" : "Take your time. I'm right here.");
  } else if (S.nudges === 1) {
    S.nudges = 2; S.lastPromptAt = Date.now();
    log("nudge", { n: 2 });
    if (S.phase === "secret") {
      const w = secretWord();
      say(`Here's a clue. The secret word starts with ${w[0]}. And remember — it uses all of your letters.`)
    } else if (S.phase === "make" || S.phase === "transfer") {
      const w = targetWordNow();
      say(`Listen again: ${w}. ${sentenceFor(w)}`);
    } else {
      say("Take your time. I'm right here.");
    }
  } else if (S.nudges === 2) {
    S.nudges = 3; S.lastPromptAt = Date.now();
    log("rest_offer", {});
    say("Would you like a rest? You can look anywhere you like — nothing happens unless you hold your eyes on a card. We can just be.");
  }
}, 5000);

// ---------- partner strip (touch only) ----------
$("partnerTab").addEventListener("click", () => $("partner").classList.toggle("show"));
$("pPause").addEventListener("click", () => {
  S.paused = !S.paused; window.Dwell && (S.paused ? Dwell.disable() : Dwell.enable());
  $("pPause").textContent = S.paused ? "▶ resume" : "⏸ pause";
  log("partner", { action: S.paused ? "pause" : "resume" });
});
function repeatPrompt() {
  if (S.phase === "make") { const { op } = alignment(S.wordIdx > 0 ? S.lesson.make[S.wordIdx - 1] : null, currentWord()); say(op); say(sentenceFor(currentWord())); }
  else if (S.phase === "sort") say(`Where does ${currentSortWord()} belong?`);
  else if (S.phase === "transfer") { const m = modelFor(currentTransferWord()); say(m ? `Spell ${currentTransferWord()}. It rhymes with ${m}.` : `Spell ${currentTransferWord()}.`); }
  else if (S.phase === "secret") say("The secret word uses all of your letters. It starts with " + secretWord()[0] + ".");
  else say("Take your time.");
  S.lastPromptAt = Date.now();   // a replay counts as a fresh prompt (nudge clock resets)
}
$("pRepeat").addEventListener("click", () => { log("partner", { action: "repeat" }); repeatPrompt(); });
$("replay").addEventListener("click", () => { log("replay", { phase: S.phase }); repeatPrompt(); });
$("pSkip").addEventListener("click", () => {          // phase-aware (review P1-9)
  log("partner", { action: "skip", phase: S.phase });
  if (S.phase === "sort") { S.sortIdx++; nextSortWord(); }
  else if (S.phase === "transfer") advanceTransfer();
  else if (S.phase === "secret") revealSecret(true);
  else if (S.phase === "make") advance();
});
$("pEasier").addEventListener("click", () => tuneDwell(+200));
$("pFaster").addEventListener("click", () => tuneDwell(-200));
function tuneDwell(d) {
  const ms = Math.max(EC.holds.floor, Math.min(EC.holds.tuneMax, (window.Dwell ? Dwell.config.ms : 1200) + d));
  if (window.Dwell) Dwell.setMs(ms);
  log("partner", { action: "dwell", ms });
}
$("pEnd").addEventListener("click", () => { log("partner", { action: "end" }); endLesson(); });
$("pClose").addEventListener("click", () => $("partner").classList.remove("show"));
$("pVoice").addEventListener("click", async () => { log("partner", { action: "voice" }); await Speech.cycleVoice(); });

// ---------- adult bar (touch-only): lesson pager + part-of-lesson picker ----------
let runwayDb = null, runwayCfg = null;
function adultLabel() {
  const e = runwayCfg.sequence[S.seqIdx];
  $("aLesson").textContent = "Lesson " + e.lesson + " · " + (S.lesson ? S.lesson.secret_word : "");
}
async function setPointer(idx) {
  idx = Math.max(0, Math.min(runwayCfg.sequence.length - 1, idx));
  S.seqIdx = idx;
  S.lesson = runwayDb.lessons.find(l => l.lesson === runwayCfg.sequence[idx].lesson);
  renderStartSub();
  adultLabel();
  fetch("/runway", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pointer: idx }) }).catch(() => {});
  log("adult_lesson_change", { lesson: S.lesson.lesson });
}
$("aPrev").addEventListener("click", () => setPointer(S.seqIdx - 1));
$("aNext").addEventListener("click", () => setPointer(S.seqIdx + 1));
document.querySelectorAll(".abtn.part").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".abtn.part").forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    S.part = b.dataset.part;
    log("adult_part", { part: S.part });
  });
});

// ---------- the door ----------
$("door").addEventListener("click", async () => {
  log("door", { phase: S.phase });
  await say("Okay — all done for now. Bye bye!");
  // EXIT DOOR (phase 4.1): on her devices, ERAgaze closes this kiosk and hands
  // the screen back to TD Snap — no helper needed. Anywhere else (dev browser),
  // fall through to the old in-app reset.
  try {
    const r = await fetch("http://127.0.0.1:49155/app/exit", { method: "POST" });
    if (r.ok) return;          // ERAgaze is closing this kiosk right now
  } catch { /* no engine here — web fallback */ }
  location.reload();
});

// ---------- confetti ----------
function confetti(n) { try { window.EllieCelebrate.confetti(n); } catch {} }
function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- boot ----------
async function boot() {
  try {
    const [lessonsRes, runwayRes] = await Promise.all([fetch("lessons.json"), fetch("runway.json")]);
    const db = await lessonsRes.json();
    buildDict(db);
    try { const so = await (await fetch("sentences.json")).json(); for (const k in so) if (k[0] !== "_") SENT_OVERRIDES[k.toLowerCase()] = so[k]; } catch {}
    const runway = await runwayRes.json();
    S.seq = runway.sequence; S.seqIdx = runway.pointer || 0;
    runwayDb = db; runwayCfg = runway;
    const entry = S.seq[S.seqIdx];
    S.lesson = db.lessons.find(l => l.lesson === entry.lesson);
    if (!S.lesson) throw new Error("lesson " + entry.lesson + " not found");
    renderStartSub();
    adultLabel();
    log("boot", { lesson: S.lesson.lesson, secret: S.lesson.secret_word, runwayIdx: S.seqIdx , dv: (window.Dwell && Dwell.version) || "pre-3" });
  } catch (e) {
    $("startTitle").textContent = "Hmm — not ready yet";
    $("startSub").textContent = "Lesson data didn't load. (Grown-ups: check the server.) ";
    $("btnStart").style.display = "none";
    log("boot_error", { message: String(e && e.message) });
  }
}
$("btnStart").addEventListener("click", async () => {
  if (!S.lesson || S.starting) return;
  // INSTANT acknowledgment (7/28): the awaits below (settings + voice warm-up)
  // take 2-4s — without this, a SUCCESSFUL press looks identical to a dead one
  // and gets judged as a failure (tonight's lesson, on video).
  S.starting = true;
  const bs = $("btnStart");
  bs.textContent = "Here we go! ✨";
  bs.style.opacity = ".75";
  // SCREEN FIRST, VOICE OVER IT (7/28): the voice warm-up (network + a full
  // spoken sample) used to run BEFORE the screen changed — 2-4s of apparent
  // death after a working press. Now: warm-up starts in the background, the
  // stage appears immediately, and the greeting plays over the new screen.
  const initP = Speech.init("Let's make words!");
  const settingsP = fetch("/settings").then(r => r.json())
  .then(s => { if (s.childName) window.ERA_CHILD_NAME = s.childName; return s; })
  .catch(() => ({}));
  $("adultBar").style.display = "none";   // hers now; adults use the partner strip
  show("stage");
  if (S.part !== "sort" && S.part !== "transfer") buildTray(S.lesson.letters, true);
  const st = await settingsP;
  if (st.dwellMs && window.Dwell) Dwell.setMs(st.dwellMs);
  const mode = await initP;
  S.tts = mode !== "off";
  if (!S.tts) { $("ttsWarn").classList.add("show"); log("tts_failed", {}); }
  log("session_start", { tts: S.tts, speech: mode, part: S.part });
  if (S.part === "sort") { await say("Let's sort your words!"); return startSort(); }
  if (S.part === "transfer") { return startSort("forTransfer"); }
  const note = (S.lesson.vowel_note || "").replace(/\.$/, "");
  await say(`Today your letters are ${S.lesson.letters.join(", ")}.` + (note ? ` ${note}.` : ""));
  S.wordIdx = 0;
  startMakeWord();
});
boot();
