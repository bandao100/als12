const STORAGE_KEY = 'banque-questions';

const SEED_QUESTIONS = [
  {
    id: 'seed-1',
    theme: 'Épidémiologie',
    question: 'La prévalence d’une maladie mesure :',
    choices: [
      'le nombre de nouveaux cas pendant une période donnée',
      'la proportion de personnes malades à un instant donné',
      'le risque relatif entre exposés et non-exposés',
    ],
    answer: 1,
    explanation: 'La prévalence est un indicateur de stock (cas existants à un instant t). L’incidence est un indicateur de flux.',
  },
  {
    id: 'seed-2',
    theme: 'Épidémiologie',
    question: 'La sensibilité d’un test diagnostique est la probabilité que le test soit positif chez :',
    choices: ['les malades', 'les non-malades', 'l’ensemble de la population'],
    answer: 0,
    explanation: 'Sensibilité = VP / (VP + FN). Elle se calcule parmi les personnes réellement malades.',
  },
  {
    id: 'seed-3',
    theme: 'Pédagogie',
    question: 'Dans la taxonomie de Bloom révisée (Anderson et Krathwohl, 2001), quel est le niveau cognitif le plus élevé ?',
    choices: ['Analyser', 'Évaluer', 'Créer'],
    answer: 2,
    explanation: 'Les six niveaux, du plus simple au plus complexe : se souvenir, comprendre, appliquer, analyser, évaluer, créer.',
  },
  {
    id: 'seed-4',
    theme: 'Pédagogie',
    question: 'L’alignement constructif (Biggs) consiste à articuler :',
    choices: [
      'les objectifs, les activités d’apprentissage et l’évaluation',
      'le budget, le calendrier et les locaux',
      'les supports de cours et les manuels uniquement',
    ],
    answer: 0,
    explanation: 'Les objectifs d’apprentissage, les activités d’enseignement-apprentissage et les modalités d’évaluation doivent être cohérents entre eux.',
  },
];

let questions = loadQuestions();
let quiz = null;

const $ = (selector) => document.querySelector(selector);

function loadQuestions() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (error) {
    console.warn('Lecture de la banque impossible, retour aux exemples :', error);
  }
  return structuredClone(SEED_QUESTIONS);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
  } catch (error) {
    console.warn('Sauvegarde locale impossible :', error);
  }
  refreshThemes();
  renderBrowse();
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function showView(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.view === name);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('is-active', view.id === `view-${name}`);
  });
}

function getThemes() {
  return [...new Set(questions.map((q) => q.theme))].sort((a, b) => a.localeCompare(b, 'fr'));
}

function fillSelect(select, themes, allLabel) {
  const current = select.value;
  select.innerHTML = '';
  select.append(new Option(allLabel, ''));
  themes.forEach((theme) => select.append(new Option(theme, theme)));
  select.value = themes.includes(current) ? current : '';
}

function refreshThemes() {
  const themes = getThemes();
  fillSelect($('#filter-theme'), themes, 'Tous les thèmes');
  fillSelect($('#quiz-theme'), themes, 'Tous les thèmes');
  $('#theme-list').innerHTML = themes
    .map((theme) => `<option value="${escapeHtml(theme)}"></option>`)
    .join('');
}

function renderBrowse() {
  const theme = $('#filter-theme').value;
  const search = $('#search').value.trim().toLowerCase();
  const matches = questions.filter((q) => {
    const text = [q.question, ...q.choices, q.explanation ?? ''].join(' ').toLowerCase();
    return (!theme || q.theme === theme) && (!search || text.includes(search));
  });

  $('#count').textContent = `${matches.length} question(s) sur ${questions.length}`;
  $('#question-list').innerHTML = matches.map(renderQuestionCard).join('');
}

function renderQuestionCard(q) {
  const choices = q.choices
    .map((choice, index) => `<li class="${index === q.answer ? 'is-correct' : ''}">${escapeHtml(choice)}</li>`)
    .join('');

  return `
    <li class="card">
      <span class="tag">${escapeHtml(q.theme)}</span>
      <h3>${escapeHtml(q.question)}</h3>
      <ol class="choices-list">${choices}</ol>
      ${q.explanation ? `<p class="explanation">${escapeHtml(q.explanation)}</p>` : ''}
      <button class="danger small" data-delete="${escapeHtml(q.id)}">Supprimer</button>
    </li>`;
}

$('#search').addEventListener('input', renderBrowse);
$('#filter-theme').addEventListener('change', renderBrowse);

$('#question-list').addEventListener('click', (event) => {
  const id = event.target.dataset.delete;
  if (!id || !confirm('Supprimer cette question ?')) return;

  questions = questions.filter((q) => q.id !== id);
  persist();
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showView(tab.dataset.view));
});

$('#question-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const theme = String(data.get('theme')).trim();
  const question = String(data.get('question')).trim();
  const choices = String(data.get('choices'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const answer = Number(data.get('answer')) - 1;

  let error = '';
  if (!theme || !question) error = 'Le thème et l’énoncé sont obligatoires.';
  else if (choices.length < 2) error = 'Indiquez au moins deux choix de réponse, un par ligne.';
  else if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) {
    error = `La bonne réponse doit être un numéro entre 1 et ${choices.length}.`;
  }

  $('#form-error').textContent = error;
  if (error) return;

  questions.push({
    id: createId(),
    theme,
    question,
    choices,
    answer,
    explanation: String(data.get('explanation')).trim(),
  });
  persist();
  form.reset();
  showView('browse');
});

$('#quiz-start').addEventListener('click', () => {
  const theme = $('#quiz-theme').value;
  const pool = questions.filter((q) => !theme || q.theme === theme);
  $('#quiz-empty').hidden = pool.length > 0;
  if (!pool.length) return;

  const requested = Number($('#quiz-count').value) || 1;
  const count = Math.min(Math.max(requested, 1), pool.length);
  quiz = { items: shuffle(pool).slice(0, count), index: 0, score: 0, mistakes: [] };

  $('#quiz-setup').hidden = true;
  $('#quiz-result').hidden = true;
  $('#quiz-play').hidden = false;
  renderQuizQuestion();
});

function renderQuizQuestion() {
  const item = quiz.items[quiz.index];
  $('#quiz-progress').textContent = `Question ${quiz.index + 1} sur ${quiz.items.length} · ${item.theme}`;
  $('#quiz-question').textContent = item.question;
  $('#quiz-choices').innerHTML = item.choices
    .map((choice, index) => `
      <label class="choice">
        <input type="radio" name="quiz-choice" value="${index}">
        <span>${escapeHtml(choice)}</span>
      </label>`)
    .join('');

  $('#quiz-feedback').hidden = true;
  $('#quiz-validate').hidden = false;
  $('#quiz-next').hidden = true;
}

$('#quiz-validate').addEventListener('click', () => {
  const feedback = $('#quiz-feedback');
  const selected = document.querySelector('input[name="quiz-choice"]:checked');
  feedback.className = 'feedback';
  feedback.hidden = false;

  if (!selected) {
    feedback.textContent = 'Sélectionnez une réponse avant de valider.';
    return;
  }

  const item = quiz.items[quiz.index];
  const chosen = Number(selected.value);
  const correct = chosen === item.answer;
  if (correct) quiz.score += 1;
  else quiz.mistakes.push(item);

  document.querySelectorAll('.choice').forEach((label, index) => {
    label.classList.toggle('is-correct', index === item.answer);
    label.classList.toggle('is-wrong', index === chosen && !correct);
    label.querySelector('input').disabled = true;
  });

  const verdict = correct
    ? 'Bonne réponse !'
    : `Mauvaise réponse. La bonne réponse était : ${item.choices[item.answer]}.`;
  feedback.textContent = [verdict, item.explanation].filter(Boolean).join(' ');
  feedback.classList.add(correct ? 'is-correct' : 'is-wrong');

  $('#quiz-validate').hidden = true;
  $('#quiz-next').hidden = false;
  $('#quiz-next').textContent = quiz.index + 1 < quiz.items.length ? 'Question suivante' : 'Voir le résultat';
});

$('#quiz-next').addEventListener('click', () => {
  quiz.index += 1;
  if (quiz.index < quiz.items.length) {
    renderQuizQuestion();
    return;
  }

  const total = quiz.items.length;
  const percent = Math.round((quiz.score / total) * 100);
  $('#quiz-score').textContent = `${quiz.score} bonne(s) réponse(s) sur ${total} (${percent} %).`;
  $('#quiz-mistakes').innerHTML = quiz.mistakes.length
    ? `<h3>À revoir</h3><ul>${quiz.mistakes.map((item) => `<li>${escapeHtml(item.question)}</li>`).join('')}</ul>`
    : '<p>Sans faute !</p>';

  $('#quiz-play').hidden = true;
  $('#quiz-result').hidden = false;
});

$('#quiz-restart').addEventListener('click', () => {
  $('#quiz-result').hidden = true;
  $('#quiz-setup').hidden = false;
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `banque-questions-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

function isValidQuestion(item) {
  return item !== null
    && typeof item === 'object'
    && typeof item.id === 'string'
    && typeof item.theme === 'string'
    && typeof item.question === 'string'
    && Array.isArray(item.choices)
    && item.choices.length >= 2
    && item.choices.every((choice) => typeof choice === 'string')
    && Number.isInteger(item.answer)
    && item.answer >= 0
    && item.answer < item.choices.length;
}

$('#import-file').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;

  const message = $('#import-message');
  try {
    const imported = JSON.parse(await file.text());
    const valid = imported.filter(isValidQuestion);
    const known = new Set(questions.map((q) => q.id));
    const added = valid.filter((q) => {
      if (known.has(q.id)) return false;
      known.add(q.id);
      return true;
    });

    questions.push(...added);
    persist();
    message.textContent = `${added.length} question(s) ajoutée(s), ${imported.length - added.length} ignorée(s).`;
  } catch (error) {
    message.textContent = 'Fichier invalide : ce n’est pas un export JSON de la banque.';
  }
  input.value = '';
});

refreshThemes();
renderBrowse();
