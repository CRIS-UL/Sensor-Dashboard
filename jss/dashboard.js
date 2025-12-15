// jss/dashboard.js
// Fully updated:
// - Last 10 shows time labels
// - All history x-axis shows month ticks (not raw timestamps)
// - Points colored by day with 7-color cycle (5th=blue, 6th=red)
// - Tooltip shows friendly date/time like "Monday 5th December 2025 07:00"

(() => {
  "use strict";

  // ====== Configuration ======
  const USER = "LukeGrif";
  const GIST_ID = "188dc885b3eddb2941c08042185fbe61";

  const RAW_LATEST = `https://gist.githubusercontent.com/${USER}/${GIST_ID}/raw/latest.json`;
  const RAW_HISTORY = `https://gist.githubusercontent.com/${USER}/${GIST_ID}/raw/history.json`;

  // ====== DOM elements ======
  const connStatusEl = document.getElementById("connStatus");
  const curTempEl = document.getElementById("curTemp");
  const curTimeEl = document.getElementById("curTime");
  const chartCanvas = document.getElementById("tempChart");
  const chartTitleEl = document.getElementById("chartTitle");
  const btnLast10 = document.getElementById("btnLast10");
  const btnAll = document.getElementById("btnAll");

  // ====== Data ======
  const labels = [];
  const temps = [];
  const fullHistory = []; // { timestamp, temperature, date }
  let showAllHistory = false;

  // For the currently displayed series:
  let displayedColorIndex = []; // per point 0..6
  let displayedDates = [];      // per point Date (for tooltips)

  // Month formatter (e.g. "Dec 2025")
  const monthFmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    year: "numeric"
  });

  // Tooltip base formatter parts
  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long" });
  const monthLongFmt = new Intl.DateTimeFormat(undefined, { month: "long" });
  const yearFmt = new Intl.DateTimeFormat(undefined, { year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  function ordinal(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (mod10 === 1) return `${n}st`;
    if (mod10 === 2) return `${n}nd`;
    if (mod10 === 3) return `${n}rd`;
    return `${n}th`;
  }

  function formatPrettyDateTime(d) {
    // Example: "Monday 5th December 2025 07:00"
    const weekday = weekdayFmt.format(d);
    const day = ordinal(d.getDate());
    const month = monthLongFmt.format(d);
    const year = yearFmt.format(d);
    const time = timeFmt.format(d);
    return `${weekday} ${day} ${month} ${year} ${time}`;
  }

  // 7-day color cycle (1st..7th). Requirement: 5th = blue, 6th = red.
  const DAY_COLORS = [
    "rgb(46, 204, 113)",  // 1st  green
    "rgb(241, 196, 15)",  // 2nd  yellow
    "rgb(155, 89, 182)",  // 3rd  purple
    "rgb(230, 126, 34)",  // 4th  orange
    "rgb(52, 152, 219)",  // 5th  BLUE
    "rgb(231, 76, 60)",   // 6th  RED
    "rgb(52, 73, 94)"     // 7th  dark
  ];

  // ====== Chart setup ======
  const tempChart = new Chart(chartCanvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Temperature (°C)",
          data: temps,
          borderWidth: 2,
          tension: 0.3,
          borderColor: "rgb(75, 192, 192)",
          fill: false,

          // Points visible + colored per day
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: (ctx) => {
            const i = ctx.dataIndex;
            const idx = displayedColorIndex[i] ?? 0;
            return DAY_COLORS[idx];
          },
          pointBorderColor: (ctx) => {
            const i = ctx.dataIndex;
            const idx = displayedColorIndex[i] ?? 0;
            return DAY_COLORS[idx];
          }
        }
      ]
    },
    options: {
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => {
              // items[0].dataIndex -> use displayedDates
              const i = items?.[0]?.dataIndex ?? 0;
              const d = displayedDates[i];
              if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
              return formatPrettyDateTime(d);
            },
            label: (item) => {
              const v = item.parsed?.y;
              if (!Number.isFinite(v)) return "Temperature: -- °C";
              return `Temperature: ${v.toFixed(1)} °C`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: "°C" }
        },
        x: {
          title: { display: true, text: "Time" },
          ticks: {
            autoSkip: true,
            maxTicksLimit: 12
          }
        }
      }
    }
  });

  // ====== Utilities ======
  async function fetchJSON(url) {
    const sep = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${sep}t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  }

  function setXAxisTickMode() {
    const x = tempChart.options.scales.x;

    if (showAllHistory) {
      x.title.text = "Month";

      // Show only month labels, and only when the month changes between shown ticks.
      x.ticks.callback = function (value, index, ticks) {
        const curLabel = this.getLabelForValue(value); // our label string
        const curDate = new Date(curLabel);
        if (Number.isNaN(curDate.getTime())) return "";

        const curKey = `${curDate.getFullYear()}-${curDate.getMonth()}`;

        if (index === 0) return monthFmt.format(curDate);

        const prevValue = ticks[index - 1]?.value;
        const prevLabel = this.getLabelForValue(prevValue);
        const prevDate = new Date(prevLabel);
        if (Number.isNaN(prevDate.getTime())) return monthFmt.format(curDate);

        const prevKey = `${prevDate.getFullYear()}-${prevDate.getMonth()}`;
        return curKey !== prevKey ? monthFmt.format(curDate) : "";
      };
    } else {
      x.title.text = "Time";
      x.ticks.callback = undefined; // default labeling
    }
  }

  function updateChart() {
    labels.length = 0;
    temps.length = 0;
    displayedColorIndex = [];
    displayedDates = [];

    const dataToUse = showAllHistory ? fullHistory : fullHistory.slice(-10);

    // Assign each calendar day an incrementing color index, repeating every 7 days
    const dayToColor = new Map(); // dayKey -> colorIdx
    let nextColor = 0;

    for (const p of dataToUse) {
      const d = p.date;

      // dayKey = YYYY-MM-DD (local)
      const dayKey =
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      if (!dayToColor.has(dayKey)) {
        dayToColor.set(dayKey, nextColor % 7);
        nextColor += 1;
      }

      displayedColorIndex.push(dayToColor.get(dayKey));
      displayedDates.push(d);

      // Labels (x-axis)
      if (showAllHistory) {
        // Keep timestamp so tick callback can derive month
        labels.push(p.timestamp);
      } else {
        // Last 10: readable times
        labels.push(d.toLocaleTimeString());
      }

      temps.push(p.temperature);
    }

    setXAxisTickMode();
    tempChart.update();

    chartTitleEl.textContent = showAllHistory
      ? "Temperature (all readings)"
      : "Temperature (last 10 readings)";
  }

  function addPoint(timestampISO, temperatureC) {
    const date = new Date(timestampISO);
    const tempNum = Number(temperatureC);
    if (!Number.isFinite(tempNum) || Number.isNaN(date.getTime())) return;

    fullHistory.push({ timestamp: timestampISO, temperature: tempNum, date });

    // Update "Now"
    curTempEl.textContent = tempNum.toFixed(1);
    curTimeEl.textContent = date.toLocaleString();

    updateChart();
  }

  function setLiveStatus(isLive) {
    if (isLive) {
      connStatusEl.textContent = "Live";
      connStatusEl.className = "badge bg-success live-badge";
    } else {
      connStatusEl.textContent = "Reconnecting…";
      connStatusEl.className = "badge bg-warning text-dark live-badge";
    }
  }

  function setHistoryMode(showAll) {
    showAllHistory = showAll;

    // Button styling
    if (showAllHistory) {
      btnAll.classList.add("btn-primary");
      btnAll.classList.remove("btn-outline-primary");
      btnLast10.classList.add("btn-outline-primary");
      btnLast10.classList.remove("btn-primary");
    } else {
      btnLast10.classList.add("btn-primary");
      btnLast10.classList.remove("btn-outline-primary");
      btnAll.classList.add("btn-outline-primary");
      btnAll.classList.remove("btn-primary");
    }

    updateChart();
  }

  // ====== Data loading ======
  async function loadHistory() {
    try {
      const history = await fetchJSON(RAW_HISTORY);

      history.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      for (const point of history) addPoint(point.timestamp, point.temperature);

      setLiveStatus(true);
    } catch (error) {
      console.warn("No history yet, will start from latest.", error);
      setLiveStatus(false);
    }
  }

  let lastTimestamp = null;

  async function pollLatest() {
    try {
      const latest = await fetchJSON(RAW_LATEST);
      const { temperature, timestamp } = latest;

      if (!lastTimestamp || timestamp !== lastTimestamp) {
        lastTimestamp = timestamp;
        addPoint(timestamp, temperature);
      }

      setLiveStatus(true);
    } catch (error) {
      console.error("Latest fetch error:", error);
      setLiveStatus(false);
    }
  }

  // ====== Map setup ======
  function initMap() {
    const UL_COORDS = [52.67379030817894, -8.571973008720438];

    const map = L.map("ul-map", { worldCopyJump: true });
    map.setView(UL_COORDS, 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    const marker = L.marker(UL_COORDS).addTo(map);
    marker.bindPopup(
      "<strong>Simulated Live Location</strong><br/>Castletroy, Limerick, Ireland"
    );
  }

  async function init() {
    btnLast10.addEventListener("click", () => setHistoryMode(false));
    btnAll.addEventListener("click", () => setHistoryMode(true));

    await loadHistory();
    await pollLatest();
    setInterval(pollLatest, 10000);

    initMap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
