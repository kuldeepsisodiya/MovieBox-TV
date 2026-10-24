/**
 * MovieBox TV Display Formatters
 */

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  if (hrs > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

export function formatTimeCode(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n) => String(n).padStart(2, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let val = Number(bytes);
  let unitIndex = 0;
  while (val >= 1024 && unitIndex < units.length - 1) {
    val /= 1024;
    unitIndex++;
  }
  return `${val.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatResolution(resolution) {
  if (!resolution) return 'HD';
  const str = String(resolution).toUpperCase();
  if (str.includes('4K') || str.includes('2160') || str.includes('UHD')) return '4K UHD';
  if (str.includes('1080') || str.includes('FHD')) return '1080p FHD';
  if (str.includes('720') || str.includes('HD')) return '720p HD';
  if (str.includes('480') || str.includes('SD')) return '480p SD';
  return str;
}

export function parseResolutionNumber(qualityStr) {
  if (!qualityStr) return 1080;
  const str = String(qualityStr).toLowerCase();
  if (str.includes('4k') || str.includes('2160') || str.includes('uhd')) return 2160;
  if (str.includes('1080')) return 1080;
  if (str.includes('720')) return 720;
  if (str.includes('480')) return 480;
  if (str.includes('360')) return 360;
  const match = str.match(/(\d{3,4})p?/);
  return match ? parseInt(match[1], 10) : 1080;
}

export function sanitizeTitle(rawTitle) {
  if (!rawTitle) return '';
  // Remove technical prefixes/suffixes often found in torrents or scrapers
  return rawTitle
    .replace(/\b(1080p|720p|2160p|4k|uhd|bluray|web-dl|x264|x265|hevc|aac|dvdrip|h264|h265)\b/gi, '')
    .replace(/[\[\]\(\)\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
