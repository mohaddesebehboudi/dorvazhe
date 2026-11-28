const REPO = "mohaddesebehboudi/dorvazhe";
const FILE_PATH = "database/players.json";
const API = "https://api.github.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function normalizeUsername(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .toLocaleLowerCase("fa");
}

function validUsername(value) {
  const name = String(value || "").trim();
  return name.length >= 2 && name.length <= 24 &&
    /^[\p{L}\p{N}_ -]+$/u.test(name);
}

async function githubRequest(path, env, options = {}) {
  return fetch(API + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + ${env.GITHUB_TOKEN},
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

async function readPlayers(env) {
  const res = await githubRequest("/repos/" + REPO + "/contents/" + FILE_PATH, env);
  if (res.status === 404) return { players: {}, sha: null };
  if (!res.ok) throw new Error("GitHub read failed: " + res.status);
  const file = await res.json();
  const decoded = atob(file.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
  const content = new TextDecoder().decode(bytes);
  return { players: JSON.parse(content || "{}"), sha: file.sha };
}

async function writePlayers(players, sha, env) {
  const content = btoa(String.fromCharCode(...new TextEncoder().encode(
    JSON.stringify(players, null, 2)
  )));
  const body = {
    message: "Update player activity log",
    content,
    ...(sha ? { sha } : {}),
    branch: "main"
  };
  return githubRequest("/repos/" + REPO + "/contents/" + FILE_PATH, env, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "POST") return response({ ok: false, error: "Method not allowed" }, 405);

    try {
      const body = await request.json();
      const username = String(body.username || "").trim();
      const key = normalizeUsername(username);
      if (!validUsername(username)) {
        return response({ ok: false, error: "نام کاربری باید ۲ تا ۲۴ نویسه و شامل حروف، عدد، فاصله، خط تیره یا زیرخط باشد." }, 400);
      }
      const action = body.action;
      if (!["register", "sync"].includes(action)) {
        return response({ ok: false, error: "درخواست نامعتبر است." }, 400);
      }

      for (let attempt = 0; attempt < 6; attempt++) {
        const { players, sha } = await readPlayers(env);
        const existing = players[key];

        if (action === "register" && existing) {
          return response({ ok: false, error: "این نام کاربری قبلاً ثبت شده است. نام دیگری انتخاب کن.", duplicate: true }, 409);
        }
        if (action === "sync" && !existing) {
          return response({ ok: false, error: "این نام کاربری ثبت نشده است. ابتدا ثبت‌نام کن." }, 404);
        }

        const now = new Date().toISOString();
        const metrics = body.metrics || {};
        players[key] = {
          username,
          totalProgress: Math.max(0, Number(metrics.totalProgress) || 0),
          wrongAnswers: Math.max(0, Number(metrics.wrongAnswers) || 0),
          loginCount: (existing?.loginCount || 0) + (action === "register" ? 1 : 0),
          firstLogin: existing?.firstLogin || now,
          lastLogin: action === "register" ? now : (existing?.lastLogin || now),
          lastUpdated: now
        };

        const saved = await writePlayers(players, sha, env);
        if (saved.ok) {
          return response({ ok: true, player: players[key] });
        }
        if (saved.status !== 409 && saved.status !== 422) {
          const detail = await saved.text();
          return response({ ok: false, error: "ذخیره در گیت‌هاب انجام نشد.", detail }, 502);
        }
      }
      return response({ ok: false, error: "تداخل هم‌زمان در ثبت اطلاعات؛ دوباره تلاش کن." }, 503);
    } catch (error) {
      return response({ ok: false, error: "خطا در ثبت اطلاعات.", detail: String(error) }, 500);
    }
  }
};
