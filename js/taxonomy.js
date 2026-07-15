// Shared folder/category taxonomy for documents — used by Library and the
// Knowledge Engine so both agree on what counts as "Full Notes".
export const FOLDER_ORDER = ['GS1', 'GS2', 'GS3', 'GS4', 'PubAd', 'Essay', 'General'];

export function suggestFolder(name) {
  const n = name.toLowerCase();
  if (/gs-?\s?1|geography|history|society|culture/.test(n)) return 'GS1';
  if (/gs-?\s?2|polity|governance|ir\b|international|constitution|social justice/.test(n)) return 'GS2';
  if (/gs-?\s?3|economy|environment|science|security|disaster/.test(n)) return 'GS3';
  if (/gs-?\s?4|ethics|integrity|aptitude/.test(n)) return 'GS4';
  if (/pubad|pub ad|public adm/.test(n)) return 'PubAd';
  if (/essay/.test(n)) return 'Essay';
  if (/model|answer/.test(n)) return 'Model Answers';
  return 'General';
}

export const folderOf = d => d.folder || suggestFolder(d.title);

// category: 'audio' = flow-audio files (audiobook), 'full' = direct full notes
// (cards / quiz / answer / diagrams). Explicit field wins; else infer.
export function categoryOf(d) {
  if (d.category) return d.category;
  if (/audio|flow/i.test(d.title + ' ' + (d.filename || ''))) return 'audio';
  if (d.uses && d.uses.audio !== false && d.uses.cards === false && d.uses.quiz === false) return 'audio';
  return 'full';
}
