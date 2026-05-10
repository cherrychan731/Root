/**
 * Google Apps Script for syncing a Google Sheet question bank to Supabase.
 *
 * Supported sheet layouts:
 * 1. One master tab named "Questions", or
 * 2. One tab per article, with a "Texts" config tab.
 *
 * Recommended for teammates: use one tab per article.
 *
 * Texts tab headers:
 * text_code | text_title | author | short_author | sheet_name | active
 *
 * Article tab headers:
 * question_code | skill | dse_year | name_tag | question | option_a | option_b | option_c | option_d | answer | explanation | source | active
 *
 * option_a is always the correct answer in Sheets.
 * answer should match option_a for compatibility.
 * The website shuffles the options before showing them to students.
 * Required script properties:
 * - SUPABASE_URL: https://YOUR_PROJECT_REF.supabase.co
 * - SUPABASE_SERVICE_ROLE_KEY: your service_role key
 *
 * In Google Sheets:
 * Extensions -> Apps Script -> paste this file -> Project Settings ->
 * Script Properties -> add the two values above.
 */

const MASTER_SHEET_NAME = 'Questions';
const TEXTS_SHEET_NAME = 'Texts';
const USE_MASTER_SHEET = false;
const IGNORED_SHEET_NAMES = new Set([
  TEXTS_SHEET_NAME,
  MASTER_SHEET_NAME,
  'Instructions',
  'Template',
  'README',
]);
const BATCH_SIZE = 500;
const MAX_QUESTION_LENGTH = 600;
const MAX_OPTION_LENGTH = 120;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('DSE Question Bank')
    .addItem('Sync to Supabase', 'syncQuestionsToSupabase')
    .addToUi();
}

function syncQuestionsToSupabase() {
  validateServiceRoleKey_();

  const spreadsheet = SpreadsheetApp.getActive();
  const records = loadQuestionRecords_(spreadsheet);
  validateQuestionRecords_(records);

  if (records.length === 0) {
    SpreadsheetApp.getUi().alert('No question rows found.');
    return;
  }

  const textsByCode = new Map();
  records.forEach((record) => {
    textsByCode.set(record.text_code, {
      text_code: record.text_code,
      display_order: record.display_order,
      title: record.text_title,
      author: record.author,
      short_author: record.short_author || record.author,
      active: true,
      updated_at: new Date().toISOString(),
    });
  });

  const questions = records.map((record) => ({
    question_code: record.question_code,
    text_code: record.text_code,
    question: record.question,
    option_a: record.option_a,
    option_b: record.option_b,
    option_c: record.option_c,
    option_d: record.option_d,
    answer: record.answer,
    explanation: record.explanation,
    dse_year: record.dse_year,
    name_tag: record.name_tag,
    skill: record.skill,
    difficulty: record.difficulty,
    source: record.source,
    active: record.active,
    updated_at: new Date().toISOString(),
  }));

  upsertBatches_('dse_texts', 'text_code', Array.from(textsByCode.values()));
  upsertBatches_('dse_questions', 'question_code', questions);

  SpreadsheetApp.getUi().alert(`Synced ${textsByCode.size} texts and ${questions.length} questions to Supabase.`);
}

function loadQuestionRecords_(spreadsheet) {
  const masterSheet = spreadsheet.getSheetByName(MASTER_SHEET_NAME);
  if (USE_MASTER_SHEET && masterSheet && masterSheet.getLastRow() > 1) {
    return recordsFromSheet_(masterSheet, null);
  }

  const textConfigs = loadTextConfigs_(spreadsheet);
  const records = [];
  spreadsheet.getSheets().forEach((sheet) => {
    const sheetName = sheet.getName();
    if (IGNORED_SHEET_NAMES.has(sheetName)) return;
    const textConfig = textConfigs.get(sheetName);
    if (!textConfig) return;

    records.push(...recordsFromSheet_(sheet, textConfig));
  });
  return records;
}

function loadTextConfigs_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(TEXTS_SHEET_NAME);
  if (!sheet) {
    throw new Error(`Missing "${TEXTS_SHEET_NAME}" tab. Add one row per article, including sheet_name.`);
  }

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) {
    throw new Error(`"${TEXTS_SHEET_NAME}" tab has no article rows.`);
  }

  const headers = rows[0].map((header) => String(header).trim());
  const configs = new Map();
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const get = (name) => valueFromRow_(headers, row, name);
    const active = parseBoolean_(get('active'), true);
    if (!active) return;

    const config = {
      text_code: clean_(get('text_code')),
      display_order: parseIntegerOrNull_(get('display_order')),
      text_title: clean_(get('text_title')),
      author: clean_(get('author')),
      short_author: clean_(get('short_author')),
      sheet_name: clean_(get('sheet_name')),
    };

    const missing = ['text_code', 'text_title', 'sheet_name'].filter((field) => !config[field]);
    if (missing.length > 0) {
      throw new Error(`Texts row ${rowNumber} is missing: ${missing.join(', ')}`);
    }

    configs.set(config.sheet_name, config);
  });

  return configs;
}

function recordsFromSheet_(sheet, textConfig) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => String(header).trim());
  return rows.slice(1)
    .map((row, index) => toQuestionRecord_(headers, row, index + 2, sheet.getName(), textConfig))
    .filter(Boolean);
}

function toQuestionRecord_(headers, row, rowNumber, sheetName, textConfig) {
  const get = (name) => {
    return valueFromRow_(headers, row, name);
  };
  const getAny = (names) => {
    for (const name of names) {
      const value = valueFromRow_(headers, row, name);
      if (value !== '' && value !== null && typeof value !== 'undefined') return value;
    }
    return '';
  };

  const questionCode = clean_(getAny(['question_code', 'ID', 'id']));
  const active = parseBoolean_(get('active'), true);
  if (!questionCode || !active) return null;
  const optionA = clean_(getAny(['option_a', 'correct_answer', 'correct']));
  const optionB = clean_(getAny(['option_b', 'wrong_1']));
  const optionC = clean_(getAny(['option_c', 'wrong_2']));
  const optionD = clean_(getAny(['option_d', 'wrong_3']));

  const record = {
    question_code: questionCode,
    text_code: textConfig ? textConfig.text_code : clean_(get('text_code')),
    display_order: textConfig ? textConfig.display_order : parseIntegerOrNull_(get('display_order')),
    text_title: textConfig ? textConfig.text_title : clean_(get('text_title')),
    author: textConfig ? textConfig.author : clean_(get('author')),
    short_author: textConfig ? textConfig.short_author : clean_(get('short_author')),
    question: clean_(getAny(['question', 'Q', 'q'])),
    option_a: optionA,
    option_b: optionB,
    option_c: optionC,
    option_d: optionD,
    answer: optionA,
    explanation: clean_(get('explanation')),
    dse_year: parseIntegerOrNull_(get('dse_year')),
    name_tag: clean_(get('name_tag')),
    skill: clean_(get('skill')),
    difficulty: 'normal',
    source: clean_(get('source')),
    active,
    _sheetName: sheetName,
    _rowNumber: rowNumber,
  };

  const missing = [
    'text_code',
    'text_title',
    'question',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
  ].filter((field) => !record[field]);

  if (missing.length > 0) {
    throw new Error(`${sheetName} row ${rowNumber} is missing: ${missing.join(', ')}`);
  }
  const explicitAnswer = clean_(getAny(['answer', 'correct_answer', 'correct']));
  if (explicitAnswer && explicitAnswer !== record.option_a) {
    throw new Error(`${sheetName} row ${rowNumber} has answer not matching option_a. Put the correct answer in option_a.`);
  }

  return record;
}

function validateQuestionRecords_(records) {
  const errors = [];
  const seenCodes = new Map();

  records.forEach((record) => {
    const location = `${record._sheetName} row ${record._rowNumber}`;
    if (seenCodes.has(record.question_code)) {
      errors.push(`${location}: duplicate question_code "${record.question_code}" also used at ${seenCodes.get(record.question_code)}.`);
    } else {
      seenCodes.set(record.question_code, location);
    }

    const required = ['question', 'option_a', 'option_b', 'option_c', 'option_d'];
    required.forEach((field) => {
      if (!record[field]) errors.push(`${location}: ${field} is blank.`);
    });

    const options = [record.option_a, record.option_b, record.option_c, record.option_d].map((value) => clean_(value));
    const uniqueOptions = new Set(options);
    if (uniqueOptions.size !== options.length) {
      errors.push(`${location}: option_a, option_b, option_c, option_d must be four different answers.`);
    }

    if (record.question.length > MAX_QUESTION_LENGTH) {
      errors.push(`${location}: question is too long (${record.question.length}/${MAX_QUESTION_LENGTH}).`);
    }
    ['option_a', 'option_b', 'option_c', 'option_d'].forEach((field) => {
      if (record[field].length > MAX_OPTION_LENGTH) {
        errors.push(`${location}: ${field} is too long (${record[field].length}/${MAX_OPTION_LENGTH}).`);
      }
    });
  });

  if (errors.length > 0) {
    throw new Error(`Question bank validation failed:\n\n${errors.join('\n')}`);
  }
}

function upsertBatches_(tableName, conflictColumn, records) {
  assertNoDuplicateUpsertKeys_(tableName, conflictColumn, records);
  for (let start = 0; start < records.length; start += BATCH_SIZE) {
    const batch = records.slice(start, start + BATCH_SIZE);
    supabaseFetch_(
      `/rest/v1/${tableName}?on_conflict=${encodeURIComponent(conflictColumn)}`,
      'post',
      batch,
      {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }
    );
  }
}

function assertNoDuplicateUpsertKeys_(tableName, conflictColumn, records) {
  const seen = new Set();
  const duplicates = new Set();
  records.forEach((record) => {
    const value = clean_(record[conflictColumn]);
    if (!value) return;
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  });
  if (duplicates.size > 0) {
    throw new Error(
      `${tableName} has duplicate ${conflictColumn} values in this sync: ${Array.from(duplicates).join(', ')}. ` +
      `Each row needs a unique ${conflictColumn}.`
    );
  }
}

function supabaseFetch_(path, method, payload, extraHeaders) {
  const props = PropertiesService.getScriptProperties();
  const supabaseUrl = normalizeSupabaseUrl_(props.getProperty('SUPABASE_URL'));
  const serviceRoleKey = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Script Properties.');
  }

  const response = UrlFetchApp.fetch(`${supabaseUrl}${path}`, {
    method,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      ...extraHeaders,
    },
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Supabase ${method.toUpperCase()} ${path} failed (${status}): ${response.getContentText()}`);
  }
}

function validateServiceRoleKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in Script Properties.');
  }
  if (key.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is a publishable key. Use the Legacy API Keys -> service_role key.');
  }
  if (key.startsWith('sb_secret_')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is an sb_secret key. For Google Apps Script, use the Legacy API Keys -> service_role key starting with eyJ...');
  }
  if (!key.startsWith('eyJ')) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY does not look like a legacy JWT key. Use Legacy API Keys -> service_role.');
  }

  const parts = key.split('.');
  if (parts.length < 2) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not a valid JWT. Copy the full Legacy API Keys -> service_role key.');
  }

  const payload = JSON.parse(
    Utilities.newBlob(
      Utilities.base64DecodeWebSafe(parts[1])
    ).getDataAsString()
  );

  if (payload.role !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY has role "${payload.role}". You copied the wrong legacy key. Use Legacy API Keys -> service_role, not anon.`);
  }
}

function clean_(value) {
  return String(value ?? '').trim();
}

function valueFromRow_(headers, row, name) {
  const index = headers.indexOf(name);
  return index === -1 ? '' : row[index];
}

function parseIntegerOrNull_(value) {
  const text = clean_(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean_(value, fallback) {
  const text = clean_(value).toLowerCase();
  if (!text) return fallback;
  return ['true', 'yes', 'y', '1', 'active'].includes(text);
}

function normalizeSupabaseUrl_(value) {
  return clean_(value)
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '');
}
