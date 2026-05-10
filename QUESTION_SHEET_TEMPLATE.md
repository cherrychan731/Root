# Google Sheet Question Bank Template

Use one config tab named `Texts`, then one question tab per article.

## `Texts` Tab

Paste this header into cell A1:

```tsv
text_code	text_title	author	short_author	sheet_name	active
```

Example:

```tsv
yueyang	岳陽樓記	范仲淹	范仲淹	09 岳陽樓記	true
lunyu	論語選讀	孔子	孔子	01 論語	true
```

`sheet_name` must exactly match the article tab name.

## Article Tabs

For each article tab, paste this header into cell A1:

```tsv
question_code	skill	dse_year	name_tag	question	option_a	option_b	option_c	option_d	answer	explanation	source	active
```

Important rule:

`option_a` is always the correct answer in Google Sheets. The website will shuffle all options before showing them to students.

Example:

```tsv
yueyang_001	字詞解釋	2023	范仲淹	「謫守巴陵郡」中的「謫」是甚麼意思？	貶官	升官	遊覽	防守	貶官	「謫」指被貶官或降職。	Internal	true
```

## Column Rules

- `question_code`: stable unique ID. Do not change it after publishing.
- The app no longer uses per-question difficulty. `簡易`, `普通`, `大師`, and `地獄` are practice modes that randomly draw 10, 20, 25, or all questions from the selected pool.
- `skill`: analysis category, for example `字詞解釋`, `句意理解`, `篇章主旨`.
- `option_a`: correct answer.
- `answer`: same as `option_a` for compatibility.
- `option_b`, `option_c`, `option_d`: distractors.
- `active`: use `true` to publish, `false` to hide without deleting.

Alias-friendly headers are also accepted by the sync script:

- `ID` can be used instead of `question_code`.
- `correct_answer` or `correct` can be used instead of `option_a`.
- `wrong_1`, `wrong_2`, `wrong_3` can be used instead of `option_b`, `option_c`, `option_d`.

## Workflow

1. Teammate edits an article tab, for example `09 岳陽樓記`.
2. Correct answer goes in both `option_a` and `answer`.
3. In Google Sheets, use `DSE Question Bank -> Sync to Supabase`.
4. The app reads active questions from Supabase and shuffles options on the website.

Security note: only put the Supabase `service_role` key in Google Apps Script Script Properties. Never paste it into browser code.
