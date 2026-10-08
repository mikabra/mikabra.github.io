// Page logic for the live study: configuration, list assignment, saving to DataPipe and the
// final screens. The trial logic and stimuli are in exp.js and stimuli.js.
//
// Data flow: the browser sends ONE CSV per participant to DataPipe at the end of the session,
// and DataPipe writes it to the Zenodo deposit. Nothing is stored on this website.
// Researcher notes (never shown to participants):
//  - Keep the Zenodo deposit an UNPUBLISHED DRAFT while collecting: publishing freezes the files
//    and makes them public.
//  - Zenodo limits files per deposit; DataPipe may batch or zip files. One file per participant
//    is fine for N of about 100.
//  - The Zenodo token set up in DataPipe expires (about 60 days): run the ?test=1 self-test
//    shortly before collecting, and again after any long gap.
//  - In DataPipe, set Conditions = 4 for this experiment (one per stimulus list).

// ----------------------------------------------------------------- configuration
// true: the CSV includes PROLIFIC_PID/STUDY_ID/SESSION_ID (needed to reconcile payment and spot
// repeat participation; pseudonymous data). false: no Prolific IDs are stored anywhere.
const STORE_PROLIFIC_IDS = true;
const DATAPIPE_ID = "ROT5ytr0hFEx";   // DataPipe experiment ID (a public identifier, not a secret)
const COMPLETION_URL = "https://app.prolific.com/submissions/complete?cc=REPLACE_WITH_CODE";
const CONTACT_EMAIL = "mika.bradley.22@ucl.ac.uk";
// "datapipe" posts data to DataPipe; "local" downloads a CSV at the end.
// While DATAPIPE_ID is still a placeholder, the page runs in local mode regardless.
const SAVE_MODE_REQUESTED = "datapipe";

const CONFIGURED = !DATAPIPE_ID.startsWith("REPLACE_");
const SAVE_MODE = CONFIGURED ? SAVE_MODE_REQUESTED : "local";
const COMPLETION_CONFIGURED = !COMPLETION_URL.includes("REPLACE_");

const N_LISTS = 4;
const CONDITION_TIMEOUT_MS = 5000;
const SAVE_RETRY_DELAYS_MS = [1500, 3000];   // up to three attempts in all

const params = new URLSearchParams(window.location.search);
// ?test=1: researcher self-test. Opens the study before the consent text is final, does not use
// up a balanced DataPipe condition, tags rows is_test = true, names the file TEST_….csv, and
// shows the save result at the end. ?list= and ?timescale= only work in test mode.
const TEST = params.get("test") === "1";
const prolific = STORE_PROLIFIC_IDS ? {
  PROLIFIC_PID: params.get("PROLIFIC_PID"),
  STUDY_ID:     params.get("STUDY_ID"),
  SESSION_ID:   params.get("SESSION_ID")
} : {};

const escHTML = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function showError(err) {
  console.error(err);
  document.body.innerHTML =
    '<div style="max-width:640px;margin:60px auto;font-family:sans-serif;line-height:1.5">' +
    '<h2>The experiment could not start</h2>' +
    '<p>Please report the message below to the researchers.</p>' +
    '<pre style="white-space:pre-wrap;background:#f4f4f4;padding:12px">' +
    escHTML(err && err.stack || err) + '</pre></div>';
}

function showPlain(html) {
  document.body.innerHTML =
    '<div style="max-width:640px;margin:80px auto;font-family:sans-serif;line-height:1.5">' + html + '</div>';
}

// ----------------------------------------------------------------- list assignment
const randomList = () => 1 + Math.floor(Math.random() * N_LISTS);
const timeout = ms => new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`no response within ${ms} ms`)), ms));

async function assignList() {
  if (TEST) {
    // never asks DataPipe, so self-tests do not unbalance the lists
    const asked = parseInt(params.get("list"), 10);
    return { list: asked >= 1 && asked <= N_LISTS ? asked : randomList(), via: "test" };
  }
  if (SAVE_MODE !== "datapipe") return { list: randomList(), via: "random (local mode)" };
  // DataPipe hands out conditions 0..k-1 in rotation; with Conditions = 4 this balances the lists.
  try {
    const c = await Promise.race([DataPipe.getCondition({ experiment_id: DATAPIPE_ID }), timeout(CONDITION_TIMEOUT_MS)]);
    if (Number.isInteger(c) && c >= 0) return { list: (c % N_LISTS) + 1, via: "datapipe" };
    console.warn("DataPipe returned no usable condition; assigning at random.", c);
  } catch (e) {
    console.warn("DataPipe condition request failed; assigning at random.", e);
  }
  return { list: randomList(), via: "random (datapipe fallback)" };
}

// ----------------------------------------------------------------- saving
const sleep = ms => new Promise(r => setTimeout(r, ms));

// One upload per participant. Returns { ok, status, attempts, body }.
async function saveToDataPipe(filename, csv) {
  let last = { ok: false, status: 0, body: null };
  for (let attempt = 1; attempt <= SAVE_RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      last = await DataPipe.saveData({ experiment_id: DATAPIPE_ID, filename: filename, data: csv });
    } catch (e) {
      last = { ok: false, status: 0, body: String(e && e.message || e) };
    }
    if (last && last.ok) return { ok: true, status: last.status, attempts: attempt, body: last.body };
    console.error(`DataPipe refused the data (HTTP ${last && last.status}), attempt ${attempt}`, last && last.body);
    if (attempt <= SAVE_RETRY_DELAYS_MS.length) await sleep(SAVE_RETRY_DELAYS_MS[attempt - 1]);
  }
  return { ok: false, status: last && last.status, attempts: SAVE_RETRY_DELAYS_MS.length + 1, body: last && last.body };
}

// ----------------------------------------------------------------- run
const jsPsych = initJsPsych({});
const file_id = jsPsych.randomization.randomID(10);
const subject_id = file_id;   // random; never derived from the Prolific ID
const filename = (TEST ? "TEST_" : "") + file_id + ".csv";

async function main() {
  if (CONSENT_HTML.includes("[[OWNER TO COMPLETE") && !TEST) {
    showPlain("<h2>This study is not open yet.</h2>");
    return;
  }

  jsPsych.data.addProperties(Object.assign(
    { subject_id: subject_id, save_mode: SAVE_MODE, is_test: TEST }, prolific));

  const { list, via } = await assignList();
  jsPsych.data.addProperties({ list: list, list_assigned_by: via });

  const { timeline } = buildTimeline(jsPsych, {
    keyboard: jsPsychHtmlKeyboardResponse,
    button:   jsPsychHtmlButtonResponse,
    form:     jsPsychSurveyHtmlForm
  }, { list: list, stimuli: STIMULI, prolific: prolific, completionURL: COMPLETION_URL,
       // test mode only: shortens presentation durations (never the response deadline)
       timeScale: TEST ? Math.min(1, Math.max(0.01, parseFloat(params.get("timescale")) || 1)) : 1 });

  await jsPsych.run(timeline);
  await finish(list, via);
}

const debrief = `<h2>Thank you</h2>
      <p class="body">The study looked at how speakers choose between sentences that are equally
      informative but carry different background assumptions: for example <em>both</em> versus
      <em>all</em>, <em>the</em> versus <em>one of the</em>, or whether to add <em>too</em>. Other
      rounds looked at everyday choices, such as whether to say <em>that</em> in cases where it is
      optional. Your choices will be used to test the predictions of a constraint-based model of
      production.</p>`;

function screen(html) {
  const el = jsPsych.getDisplayElement();
  el.innerHTML = `<div class="jspsych-content-wrapper"><div class="jspsych-content">${html}</div></div>`;
  return el;
}

function button(el, label, onClick) {
  const b = document.createElement("button");
  b.className = "jspsych-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  el.querySelector(".jspsych-content").appendChild(b);
  return b;
}

function localSave() {
  jsPsych.data.get().localSave("csv", filename);
}

async function finish(list, via) {
  const csv = jsPsych.data.get().csv();
  const rows = jsPsych.data.get().count();
  let save = { ok: false, status: null, attempts: 0 };

  if (SAVE_MODE === "datapipe") {
    screen('<p class="body">Saving your responses…</p>');
    save = await saveToDataPipe(filename, csv);
  }
  // kept out of the CSV (it has already been uploaded); for the console and the test screen
  const saveInfo = { save_status: SAVE_MODE === "datapipe" ? (save.ok ? "ok" : "failed") : "local",
                     save_http_status: save.status, save_attempts: save.attempts, filename: filename };
  (save.ok ? console.info : console.error)("Save result", saveInfo);

  const testInfo = TEST ? `<div class="body" style="border:1px dashed #999;padding:8px 12px;margin:18px 0">
      <strong>Test mode</strong><br>
      Save: ${escHTML(saveInfo.save_status)} (HTTP ${escHTML(saveInfo.save_http_status)}, ${escHTML(saveInfo.save_attempts)} attempt(s))<br>
      File: ${escHTML(filename)}<br>
      List: ${escHTML(list)} (assigned by ${escHTML(via)})<br>
      Data rows: ${escHTML(rows)}</div>` : "";

  const done = () => {
    if (COMPLETION_CONFIGURED) {
      const el = screen(debrief + testInfo + '<p class="body">Click below to register your completion on Prolific.</p>');
      button(el, "Finish and return to Prolific", () => { window.location = COMPLETION_URL; });
    } else {
      screen(debrief + testInfo + (TEST
        ? '<p class="body"><strong>Completion code not configured (test).</strong></p>'
        : '<p class="body">Thank you, you can close this window.</p>'));
    }
  };

  if (SAVE_MODE === "local") {
    const el = screen(debrief + testInfo + '<p class="body">Your data will download as a CSV when you click below.</p>');
    button(el, "Download data", () => { localSave(); done(); });
    return;
  }
  if (save.ok) { done(); return; }

  // Saving failed: never go on to the Prolific redirect without the participant's data.
  const el = screen(`<h2>One more step</h2>
    <p class="body">We couldn't save your responses automatically. Please click below to download
    your data file and email it to ${escHTML(CONTACT_EMAIL)}, then continue.</p>` + testInfo);
  button(el, "Download data file", function () {
    localSave();
    this.disabled = true;
    button(el, "Continue", done);
  });
}

main().catch(showError);
