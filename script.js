(() => {
  // Paste your OpenWeatherMap API key between the quotes:
  const API_KEY = "6454d8f7d5b821b332824f889350309f";

  const BASE = "https://api.openweathermap.org";
  const $ = (id) => document.getElementById(id);

  let unit = "c",
    data = null,
    recent = [];
  try {
    recent = JSON.parse(localStorage.getItem("recent2") || "[]");
  } catch (e) {}

  const conv = (c) =>
    unit === "c" ? Math.round(c) : Math.round((c * 9) / 5 + 32);
  const deg = (c) => conv(c) + "°";
  const iconURL = (code, size = "2x") =>
    `https://openweathermap.org/img/wn/${code}@${size}.png`;
  const ic = (p) => `<svg class="i" viewBox="0 0 24 24">${p}</svg>`;
  const ICONS = {
    thermo: ic(
      '<path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/>'
    ),
    drop: ic('<path d="M12 3s6 6.3 6 10.8a6 6 0 0 1-12 0C6 9.3 12 3 12 3z"/>'),
    wind: ic(
      '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h6"/>'
    ),
    gauge: ic('<circle cx="12" cy="12" r="9"/><path d="M12 12l4-4"/>'),
    eye: ic(
      '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>'
    ),
    cloud: ic('<path d="M17.5 19H7a5 5 0 1 1 1.3-9.8A6 6 0 0 1 17.5 19z"/>'),
    sun: ic(
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
    )
  };

  function moodOf(id) {
    if (id >= 200 && id < 300) return "storm";
    if (id >= 300 && id < 600) return "rain";
    if (id >= 600 && id < 700) return "snow";
    if (id === 800 || id === 801) return "clear"; // clear or a few clouds: keep the blue sky
    return "cloud";
  }

  function showMsg(text, type) {
    const m = $("msg");
    m.textContent = text;
    m.className = type || "";
    m.style.display = text ? "" : "none";
  }
  function setLoading(on) {
    document.body.classList.toggle("loading", on);
    $("go").disabled = $("loc").disabled = on;
    if (on) showMsg("Loading weather…", "info");
  }
  const NO_KEY =
    "Add your OpenWeatherMap API key to the API_KEY line in the script, then reload the page.";

  async function getJSON(path, params) {
    const url = `${BASE}${path}?${new URLSearchParams({ ...params, appid: API_KEY })}`;
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error(
        "Can't reach OpenWeatherMap. Check your internet connection and try again."
      );
    }
    if (res.ok) return res.json();
    if (res.status === 401)
      throw new Error(
        "The API key was rejected. Check API_KEY in the script for typos. New keys can take up to 2 hours to activate."
      );
    if (res.status === 404)
      throw new Error(
        "City not found. Check the spelling or try a nearby city."
      );
    if (res.status === 429)
      throw new Error("Too many requests. Wait a minute and try again.");
    throw new Error(
      `OpenWeatherMap returned an error (${res.status}). Try again in a moment.`
    );
  }

  function validate(name) {
    const v = name.trim();
    if (!v) return { error: "Enter a city name to search." };
    if (v.length < 2)
      return { error: "City name is too short. Enter at least 2 letters." };
    if (!/^[\p{L}\s.'\-,]+$/u.test(v))
      return {
        error:
          "City names can only contain letters, spaces, and basic punctuation."
      };
    return { value: v };
  }

  // params: { q } or { lat, lon }. label overrides the place name shown.
  async function load(params, label) {
    if (!API_KEY) return showMsg(NO_KEY, "error");
    setLoading(true);
    try {
      const current = await getJSON("/data/2.5/weather", {
        ...params,
        units: "metric"
      });
      const forecast = await getJSON("/data/2.5/forecast", {
        lat: current.coord.lat,
        lon: current.coord.lon,
        units: "metric"
      });
      data = {
        current,
        forecast,
        label: label || `${current.name}, ${current.sys.country}`
      };
      render();
      showMsg("");
      return current;
    } catch (e) {
      showMsg(e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function searchCity(name) {
    const { error, value } = validate(name);
    if (error) return showMsg(error, "error");
    const cur = await load({ q: value });
    if (cur)
      remember({ label: data.label, lat: cur.coord.lat, lon: cur.coord.lon });
  }

  async function loadPlace(p) {
    $("q").value = p.label;
    const cur = await load({ lat: p.lat, lon: p.lon }, p.label);
    if (cur) remember({ label: p.label, lat: p.lat, lon: p.lon });
  }

  /* ---------- location suggestions ---------- */
  let places = [],
    active = -1,
    timer = 0,
    reqId = 0;

  function hideSugg() {
    $("sugg").hidden = true;
    active = -1;
    $("q").setAttribute("aria-expanded", "false");
    $("q").removeAttribute("aria-activedescendant");
  }
  function setActive(i) {
    active = i;
    [...$("sugg").children].forEach((li, n) =>
      li.setAttribute("aria-selected", n === i)
    );
    if (i >= 0) $("q").setAttribute("aria-activedescendant", "s" + i);
    else $("q").removeAttribute("aria-activedescendant");
  }
  function drawSugg() {
    const ul = $("sugg");
    ul.innerHTML = "";
    if (!places.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No matching places. Check the spelling.";
      ul.appendChild(li);
    }
    places.forEach((p, i) => {
      const li = document.createElement("li");
      li.id = "s" + i;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.textContent = p.name;
      const small = document.createElement("small");
      small.textContent = [p.state, p.country].filter(Boolean).join(", ");
      li.appendChild(small);
      li.dataset.i = i;
      ul.appendChild(li);
    });
    ul.hidden = false;
    active = -1;
    $("q").setAttribute("aria-expanded", "true");
  }
  async function suggest(text) {
    const v = text.trim();
    if (v.length < 2 || !API_KEY || !/^[\p{L}\s.'\-,]+$/u.test(v))
      return hideSugg();
    const id = ++reqId;
    try {
      const res = await fetch(
        `${BASE}/geo/1.0/direct?${new URLSearchParams({ q: v, limit: 5, appid: API_KEY })}`
      );
      if (!res.ok) return hideSugg();
      const list = await res.json();
      if (id !== reqId) return;
      const seen = new Set();
      places = list
        .map((p) => ({
          name: p.name,
          state: p.state,
          country: p.country,
          lat: p.lat,
          lon: p.lon,
          label: [p.name, p.state, p.country].filter(Boolean).join(", ")
        }))
        .filter((p) => !seen.has(p.label) && seen.add(p.label));
      drawSugg();
    } catch {
      hideSugg();
    }
  }

  $("q").addEventListener("input", () => {
    clearTimeout(timer);
    reqId++;
    timer = setTimeout(() => suggest($("q").value), 300);
  });
  $("q").addEventListener("keydown", (e) => {
    const open = !$("sugg").hidden && places.length;
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setActive((active + 1) % places.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive((active - 1 + places.length) % places.length);
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      const p = places[active];
      hideSugg();
      loadPlace(p);
    } else if (e.key === "Escape") hideSugg();
  });
  $("sugg").addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    e.preventDefault();
    const p = places[+li.dataset.i];
    hideSugg();
    loadPlace(p);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".field")) hideSugg();
  });

  /* ---------- rendering ---------- */
  const cityDate = (sec, tz) => new Date((sec + tz) * 1000);
  const fmtTime = (sec, tz) =>
    cityDate(sec, tz).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC"
    });
  const fmtHour = (sec, tz) =>
    cityDate(sec, tz).toLocaleTimeString([], {
      hour: "numeric",
      timeZone: "UTC"
    });
  const compass = (d) =>
    ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];

  function daily(list, tz) {
    const days = {};
    list.forEach((e) => {
      const d = cityDate(e.dt, tz),
        k = d.toISOString().slice(0, 10),
        hour = d.getUTCHours();
      const day = (days[k] ||= {
        date: d,
        min: Infinity,
        max: -Infinity,
        pop: 0,
        best: null,
        gap: 99
      });
      day.min = Math.min(day.min, e.main.temp_min);
      day.max = Math.max(day.max, e.main.temp_max);
      day.pop = Math.max(day.pop, e.pop || 0);
      const gap = Math.abs(hour - 13);
      if (gap < day.gap) {
        day.gap = gap;
        day.best = e.weather[0];
      }
    });
    return Object.values(days).slice(0, 5);
  }

  // Half-circle sun path with a dot for where the sun is now
  function sunTile(c, tz) {
    const { sunrise, sunset } = c.sys;
    const p = (c.dt - sunrise) / (sunset - sunrise),
      up = p >= 0 && p <= 1;
    const k = Math.min(Math.max(p, 0), 1);
    const cx = 100 - 90 * Math.cos(Math.PI * k),
      cy = 100 - 90 * Math.sin(Math.PI * k);
    return (
      `<div class="tile glass sun"><h3>${ICONS.sun}Sun</h3><div class="sunbody">` +
      `<svg class="arc" viewBox="0 0 200 110" aria-hidden="true">` +
      `<path d="M10,100 A90,90 0 0 1 190,100" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>` +
      `<line x1="0" y1="100" x2="200" y2="100" stroke="rgba(255,255,255,.3)"/>` +
      (up ? `<circle cx="${cx}" cy="${cy}" r="7" fill="#ffd166"/>` : "") +
      `</svg>` +
      `<div class="times"><div><span>Sunrise</span>${fmtTime(sunrise, tz)}</div><div><span>Sunset</span>${fmtTime(sunset, tz)}</div></div></div></div>`
    );
  }

  function render() {
    const c = data.current,
      tz = c.timezone,
      w = c.weather[0];
    document.body.dataset.mood = moodOf(w.id);
    document.body.dataset.night = w.icon.endsWith("n") ? "1" : "0";
    $("view").style.display = "grid";

    const days = daily(data.forecast.list, tz);
    $("place").textContent = data.label;
    $("time").textContent = cityDate(c.dt, tz).toLocaleString([], {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC"
    });
    $("temp").textContent = deg(c.main.temp);
    $("cond").textContent = w.description;
    $("hl").textContent =
      `High ${deg(Math.max(days[0].max, c.main.temp))} · Low ${deg(Math.min(days[0].min, c.main.temp))}`;
    $("icon").src = iconURL(w.icon, "4x");
    $("icon").alt = w.main;

    // next 24 hours: icon, temperature and a small bar showing how warm it is relative to the other hours
    const hrs = data.forecast.list.slice(0, 8);
    const ts = hrs.map((h) => h.main.temp),
      lo = Math.min(...ts),
      span = Math.max(...ts) - lo || 1;
    $("hours").innerHTML = hrs
      .map(
        (h) =>
          `<div class="hr"><span>${fmtHour(h.dt, tz)}</span><img src="${iconURL(h.weather[0].icon)}" alt="${h.weather[0].description}" title="${h.weather[0].description}">` +
          `<b>${deg(h.main.temp)}</b><div class="trk"><i style="height:${Math.round(20 + (80 * (h.main.temp - lo)) / span)}%"></i></div>` +
          `<small>${h.pop >= 0.1 ? Math.round(h.pop * 100) + "%" : ""}</small></div>`
      )
      .join("");

    const wmin = Math.min(...days.map((d) => d.min)),
      wmax = Math.max(...days.map((d) => d.max)),
      wspan = wmax - wmin || 1;
    $("days").innerHTML = days
      .map((d, i) => {
        const left = ((d.min - wmin) / wspan) * 100,
          width = Math.max(((d.max - d.min) / wspan) * 100, 6);
        return (
          `<div class="day"><div class="n">${i === 0 ? "Today" : d.date.toLocaleDateString([], { weekday: "short", timeZone: "UTC" })}</div>` +
          `<img src="${iconURL(d.best.icon)}" alt="${d.best.description}" title="${d.best.description}">` +
          `<div class="p">${d.pop >= 0.1 ? Math.round(d.pop * 100) + "%" : ""}</div>` +
          `<div class="lo">${deg(d.min)}</div>` +
          `<div class="range"><i style="left:${left}%;width:${width}%"></i></div>` +
          `<div class="hi">${deg(d.max)}</div></div>`
        );
      })
      .join("");

    const vis =
      c.visibility != null
        ? (c.visibility / 1000).toFixed(c.visibility >= 10000 ? 0 : 1)
        : "–";
    const wd = c.wind.deg ?? 0;
    $("tiles").innerHTML =
      `<div class="tile glass"><h3>${ICONS.thermo}Feels like</h3><b>${deg(c.main.feels_like)}</b></div>` +
      `<div class="tile glass"><h3>${ICONS.drop}Humidity</h3><b>${c.main.humidity}<small>%</small></b><div class="meter"><i style="width:${c.main.humidity}%"></i></div></div>` +
      `<div class="tile glass"><h3>${ICONS.wind}Wind</h3><b>${Math.round(c.wind.speed * 3.6)}<small>km/h</small></b>` +
      `<p><span class="arrow" style="transform:rotate(${wd + 180}deg)">↑</span> from ${compass(wd)}</p></div>` +
      `<div class="tile glass"><h3>${ICONS.gauge}Pressure</h3><b>${c.main.pressure}<small>hPa</small></b></div>` +
      `<div class="tile glass"><h3>${ICONS.eye}Visibility</h3><b>${vis}<small>km</small></b></div>` +
      `<div class="tile glass"><h3>${ICONS.cloud}Cloud cover</h3><b>${c.clouds ? c.clouds.all : 0}<small>%</small></b></div>` +
      sunTile(c, tz);
  }

  /* ---------- recent searches ---------- */
  function remember(entry) {
    recent = [
      entry,
      ...recent.filter(
        (r) => r.label.toLowerCase() !== entry.label.toLowerCase()
      )
    ].slice(0, 5);
    try {
      localStorage.setItem("recent2", JSON.stringify(recent));
    } catch (e) {}
    drawRecent();
  }
  function drawRecent() {
    const box = $("recent");
    box.innerHTML = "";
    recent.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = r.label;
      b.onclick = () => {
        hideSugg();
        loadPlace(r);
      };
      box.appendChild(b);
    });
  }

  /* ---------- events ---------- */
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(timer);
    reqId++;
    hideSugg();
    searchCity($("q").value);
  });

  $("loc").addEventListener("click", () => {
    hideSugg();
    if (!navigator.geolocation)
      return showMsg(
        "Your browser doesn't support location. Search for a city instead.",
        "error"
      );
    navigator.geolocation.getCurrentPosition(
      (pos) => load({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        showMsg(
          err.code === 1
            ? "Location access was blocked. Allow it in your browser, or search for a city."
            : "Couldn't get your location. Search for a city instead.",
          "error"
        ),
      { timeout: 10000 }
    );
  });

  document.querySelectorAll(".unit button").forEach((b) =>
    b.addEventListener("click", () => {
      unit = b.dataset.u;
      document
        .querySelectorAll(".unit button")
        .forEach((x) => x.setAttribute("aria-pressed", x === b));
      if (data) render();
    })
  );

  drawRecent();
  if (!API_KEY) showMsg(NO_KEY, "error");
  else if (recent[0]) loadPlace(recent[0]);
  else searchCity("Manila");
})();
