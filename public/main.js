const form = document.getElementById('scrape-form');
const resetBtn = document.getElementById('reset');
const resultEl = document.getElementById('result');
const listingsEl = document.getElementById('listings');
const jsonRawEl = document.getElementById('jsonRaw');

function renderListings(listings) {
  listingsEl.innerHTML = '';
  listingsEl.className = 'list';
  for (const item of listings) {
    const card = document.createElement('div');
    card.className = 'card';

    if (item.image_url) {
      const img = document.createElement('img');
      img.src = item.image_url;
      img.alt = item.name || 'Listing image';
      card.appendChild(img);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = item.name || '(no title)';
    card.appendChild(name);

    if (item.price) {
      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = item.price;
      card.appendChild(price);
    }

    if (item.url) {
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open';
      card.appendChild(link);
    }

    listingsEl.appendChild(card);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = document.getElementById('query').value.trim();
  const daysSinceListed = document.getElementById('daysSinceListed').value;
  const categoryVal = document.getElementById('category').value.trim();
  const minPriceVal = document.getElementById('minPrice').value.trim();
  const maxPriceVal = document.getElementById('maxPrice').value.trim();
  const mode = document.getElementById('mode').value;

  if (!query) return;

  const payload = {
    query,
    daysSinceListed: Number(daysSinceListed),
    mode
  };
  if (categoryVal !== '') payload.category = categoryVal;
  if (minPriceVal !== '') {
    const n = Number(minPriceVal);
    if (!Number.isNaN(n) && n >= 0) payload.minPrice = n;
  }
  if (maxPriceVal !== '') {
    const n = Number(maxPriceVal);
    if (!Number.isNaN(n) && n >= 0) payload.maxPrice = n;
  }

  const button = e.target.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Running...';

  try {
    const resp = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Request failed');

    resultEl.classList.remove('hidden');

    try {
      const parsed = JSON.parse(data.json);
      renderListings(parsed.listings || []);
      jsonRawEl.classList.add('hidden');
      jsonRawEl.textContent = '';
    } catch {
      // Fallback render raw
      jsonRawEl.classList.remove('hidden');
      jsonRawEl.textContent = data.json;
      listingsEl.innerHTML = '';
      listingsEl.className = '';
    }
  } catch (err) {
    resultEl.classList.remove('hidden');
    listingsEl.innerHTML = '';
    listingsEl.className = '';
    jsonRawEl.classList.remove('hidden');
    jsonRawEl.textContent = `Error: ${err.message || err}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Run';
  }
});

// Use native reset + cleanup UI
form.addEventListener('reset', () => {
  setTimeout(() => {
    listingsEl.innerHTML = '';
    listingsEl.className = '';
    jsonRawEl.textContent = '';
    jsonRawEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Run';
    }
  });
});

resetBtn.addEventListener('click', () => {}); 