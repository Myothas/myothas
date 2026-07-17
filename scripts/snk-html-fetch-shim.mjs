// Preload shim for Platane/snk's bundled action (run via `node --import`).
//
// GitHub's GraphQL API answers RESOURCE_LIMITS_EXCEEDED for this account's
// contributionCalendar.weeks (too much automated activity in the window), so
// snk's normal fetch path can never succeed. The public HTML endpoint
// https://github.com/users/<login>/contributions still renders the full
// calendar, so this shim intercepts snk's GraphQL POST and answers it with
// the same JSON shape, parsed out of that HTML instead.

const realFetch = globalThis.fetch;

const LEVELS = [
  "NONE",
  "FIRST_QUARTILE",
  "SECOND_QUARTILE",
  "THIRD_QUARTILE",
  "FOURTH_QUARTILE",
];

async function fetchCalendarFromHtml(login) {
  const res = await realFetch(
    `https://github.com/users/${encodeURIComponent(login)}/contributions`,
    { headers: { "User-Agent": "snk-html-fetch-shim" } },
  );
  if (!res.ok)
    throw new Error(`contributions page returned HTTP ${res.status}`);
  const html = await res.text();

  // <tool-tip for="contribution-day-component-<weekday>-<week>">33 contributions on July 13th.</tool-tip>
  const counts = new Map();
  for (const m of html.matchAll(
    /for="contribution-day-component-(\d+)-(\d+)"[^>]*>\s*(\d+|No) contribution/g,
  )) {
    counts.set(`${m[1]}-${m[2]}`, m[3] === "No" ? 0 : Number(m[3]));
  }

  // <td ... data-date="2025-07-13" id="contribution-day-component-0-0" data-level="1" ...>
  const weeks = [];
  for (const m of html.matchAll(/<td\b[^>]*\bdata-date="[^"]+"[^>]*>/g)) {
    const tag = m[0];
    const date = tag.match(/data-date="([^"]+)"/)?.[1];
    const id = tag.match(/id="contribution-day-component-(\d+)-(\d+)"/);
    const level = tag.match(/data-level="(\d)"/)?.[1];
    if (!date || !id || level === undefined) continue;
    const [, weekday, week] = id;
    (weeks[+week] ??= { contributionDays: [] }).contributionDays.push({
      contributionCount: counts.get(`${weekday}-${week}`) ?? 0,
      contributionLevel: LEVELS[+level],
      weekday: +weekday,
      date,
    });
  }

  const filled = weeks.filter(Boolean);
  if (filled.length < 40)
    throw new Error(
      `parsed only ${filled.length} weeks from the contributions HTML — page markup may have changed`,
    );
  return filled;
}

globalThis.fetch = async (url, opts) => {
  if (String(url).endsWith("/graphql") && opts?.method === "POST") {
    const { variables } = JSON.parse(opts.body);
    console.log(
      `🩹 shim: answering GraphQL query for ${variables.login} from the HTML contributions page`,
    );
    const weeks = await fetchCalendarFromHtml(variables.login);
    return new Response(
      JSON.stringify({
        data: {
          user: {
            contributionsCollection: { contributionCalendar: { weeks } },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return realFetch(url, opts);
};
