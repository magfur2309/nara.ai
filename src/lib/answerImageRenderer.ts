import type { CitationSource } from '../types/sop';

interface RenderAnswerImageParams {
  question: string;
  content: string;
  citations?: CitationSource[];
  hasConflict?: boolean;
  answered?: boolean;
}

interface ParsedBlock {
  kind: 'step' | 'bullet' | 'paragraph' | 'conflict';
  numberLabel?: string;
  title?: string;
  body: string;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

function parseAnswerBlocks(content: string): ParsedBlock[] {
  const rawLines = content.split('\n');
  const blocks: ParsedBlock[] = [];

  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    if (/^\*\*Catatan Konflik SOP:\*\*/i.test(trimmed)) {
      blocks.push({
        kind: 'conflict',
        title: 'Catatan Konflik SOP',
        body: stripMarkdown(trimmed.replace(/^\*\*Catatan Konflik SOP:\*\*/i, '')),
      });
      continue;
    }

    const numMatch = trimmed.match(/^(\d+)[\.\)]\s+(.+)$/);
    if (numMatch) {
      const rest = numMatch[2];
      const colonIdx = rest.indexOf(':');
      const boldLead = rest.match(/^\*\*([^*]+)\*\*[:\-\s]*(.*)$/);
      if (boldLead) {
        blocks.push({
          kind: 'step',
          numberLabel: numMatch[1].padStart(2, '0'),
          title: stripMarkdown(boldLead[1]),
          body: stripMarkdown(boldLead[2] || boldLead[1]),
        });
      } else if (colonIdx > 3 && colonIdx < 56) {
        blocks.push({
          kind: 'step',
          numberLabel: numMatch[1].padStart(2, '0'),
          title: stripMarkdown(rest.slice(0, colonIdx)),
          body: stripMarkdown(rest.slice(colonIdx + 1)),
        });
      } else {
        blocks.push({
          kind: 'step',
          numberLabel: numMatch[1].padStart(2, '0'),
          body: stripMarkdown(rest),
        });
      }
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bulletMatch) {
      const rest = bulletMatch[1];
      const boldLead = rest.match(/^\*\*([^*]+)\*\*[:\-\s]*(.*)$/);
      if (boldLead) {
        blocks.push({
          kind: 'bullet',
          title: stripMarkdown(boldLead[1]),
          body: stripMarkdown(boldLead[2] || boldLead[1]),
        });
      } else {
        blocks.push({
          kind: 'bullet',
          body: stripMarkdown(rest),
        });
      }
      continue;
    }

    const cleaned = stripMarkdown(trimmed);
    if (!cleaned) continue;

    const prev = blocks[blocks.length - 1];
    if (prev && prev.kind === 'step' && !trimmed.startsWith('Sumber') && blocks.length > 0 && cleaned.length < 180) {
      prev.body = `${prev.body}\n${cleaned}`.trim();
    } else {
      blocks.push({ kind: 'paragraph', body: cleaned });
    }
  }

  return blocks.slice(0, 14);
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 12
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        if (current) lines.push(current);
        if (ctx.measureText(word).width > maxWidth) {
          // Break very long tokens gracefully
          let slice = '';
          for (const ch of word) {
            if (ctx.measureText(slice + ch).width > maxWidth) {
              if (slice) lines.push(slice);
              slice = ch;
            } else {
              slice += ch;
            }
          }
          current = slice;
        } else {
          current = word;
        }
      }
      if (lines.length >= maxLines) break;
    }
    if (current && lines.length < maxLines) {
      lines.push(current);
    }
    if (lines.length >= maxLines) break;
  }

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -3)}...` : last;
  }
  return lines;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function renderSopAnswerToImage(params: RenderAnswerImageParams): string {
  const width = 920;
  const padX = 36;
  const contentWidth = width - padX * 2;
  const scale = 1.5;

  const measureCanvas = document.createElement('canvas');
  const mCtx = measureCanvas.getContext('2d');
  if (!mCtx) return '';

  const blocks = parseAnswerBlocks(params.content);
  const primaryCit = params.citations?.[0];
  const sopBadge = primaryCit
    ? `${primaryCit.docNumber} · v${primaryCit.version}`
    : params.answered === false
      ? 'INFORMASI SOP'
      : 'RINGKASAN PROSEDUR';

  mCtx.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const questionText = params.question?.trim() || 'Jawaban NARA AI';
  const questionLines = wrapTextLines(mCtx, questionText, contentWidth - 20, 3);

  const headerHeight = 92 + questionLines.length * 30 + 26;

  interface LayoutItem {
    block: ParsedBlock;
    titleLines: string[];
    bodyLines: string[];
    boxHeight: number;
    hasArrowBefore: boolean;
  }

  const layouts: LayoutItem[] = [];
  let prevWasStep = false;

  for (const block of blocks) {
    const isStep = block.kind === 'step';
    const hasArrowBefore = isStep && prevWasStep;
    prevWasStep = isStep;

    const textInnerWidth = isStep ? contentWidth - 96 : contentWidth - 44;

    let titleLines: string[] = [];
    if (block.title) {
      mCtx.font = '700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      titleLines = wrapTextLines(mCtx, block.title, textInnerWidth, 2);
    }

    mCtx.font = '400 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const bodyLines = block.body
      ? wrapTextLines(mCtx, block.body, textInnerWidth, 9)
      : [];

    const titleH = titleLines.length > 0 ? titleLines.length * 21 + 4 : 0;
    const bodyH = bodyLines.length * 20;
    const boxHeight = Math.max(isStep ? 64 : 46, 26 + titleH + bodyH);

    layouts.push({
      block,
      titleLines,
      bodyLines,
      boxHeight,
      hasArrowBefore,
    });
  }

  const bodyGap = 14;
  const arrowGap = 24;
  let totalBlocksHeight = 0;
  for (let i = 0; i < layouts.length; i++) {
    if (i > 0) {
      totalBlocksHeight += layouts[i].hasArrowBefore ? arrowGap : bodyGap;
    }
    totalBlocksHeight += layouts[i].boxHeight;
  }

  const footerHeight = 62;
  const totalHeight = Math.max(320, headerHeight + 28 + totalBlocksHeight + 28 + footerHeight);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.scale(scale, scale);

  // Page canvas background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, totalHeight);

  // Header gradient
  const grad = ctx.createLinearGradient(0, 0, width, headerHeight);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#0369a1');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, headerHeight);

  // Header Top Label
  ctx.fillStyle = '#7dd3fc';
  ctx.font = '700 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('NARA AI · INFOGRAFIS JAWABAN PROSEDUR', padX, 34);

  // Top-right badge pill
  ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const badgeW = ctx.measureText(sopBadge).width + 22;
  const badgeX = width - padX - badgeW;
  drawRoundedRect(ctx, badgeX, 18, badgeW, 24, 6);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#f0f9ff';
  ctx.fillText(sopBadge, badgeX + 11, 34);

  // Divider inside header
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(padX, 54);
  ctx.lineTo(width - padX, 54);
  ctx.stroke();

  // Question Title
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  let qY = 86;
  for (const line of questionLines) {
    ctx.fillText(line, padX, qY);
    qY += 30;
  }

  // Sub-caption in header
  if (primaryCit) {
    ctx.fillStyle = '#bae6fd';
    ctx.font = '500 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const citText = `${primaryCit.title} (${primaryCit.divisionName})`;
    ctx.fillText(citText.slice(0, 88), padX, headerHeight - 18);
  }

  // Render content blocks
  let cursorY = headerHeight + 28;

  for (let i = 0; i < layouts.length; i++) {
    const item = layouts[i];
    const { block } = item;

    if (i > 0) {
      if (item.hasArrowBefore) {
        const arrowX = padX + 34;
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(arrowX, cursorY + 2);
        ctx.lineTo(arrowX, cursorY + arrowGap - 4);
        ctx.stroke();

        // Arrow head
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.moveTo(arrowX - 5, cursorY + arrowGap - 9);
        ctx.lineTo(arrowX + 5, cursorY + arrowGap - 9);
        ctx.lineTo(arrowX, cursorY + arrowGap - 2);
        ctx.closePath();
        ctx.fill();

        cursorY += arrowGap;
      } else {
        cursorY += bodyGap;
      }
    }

    // Card background & border
    drawRoundedRect(ctx, padX, cursorY, contentWidth, item.boxHeight, 10);
    if (block.kind === 'conflict') {
      ctx.fillStyle = '#fffbeb';
      ctx.fill();
      ctx.strokeStyle = '#fcd34d';
    } else if (block.kind === 'step') {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#bae6fd';
    } else if (block.kind === 'bullet') {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
    } else {
      ctx.fillStyle = '#f1f5f9';
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
    }
    ctx.lineWidth = 1.2;
    ctx.stroke();

    let textX = padX + 20;
    let textY = cursorY + 28;

    if (block.kind === 'step') {
      // Number badge circle
      const cx = padX + 34;
      const cy = cursorY + 31;
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      const numStr = block.numberLabel || '01';
      const numW = ctx.measureText(numStr).width;
      ctx.fillText(numStr, cx - numW / 2, cy + 4.5);

      textX = padX + 68;
    } else if (block.kind === 'bullet') {
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.arc(padX + 24, cursorY + 23, 4, 0, Math.PI * 2);
      ctx.fill();
      textX = padX + 38;
    }

    if (item.titleLines.length > 0) {
      ctx.fillStyle = block.kind === 'conflict' ? '#92400e' : '#0f172a';
      ctx.font = '700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      for (const tLine of item.titleLines) {
        ctx.fillText(tLine, textX, textY);
        textY += 21;
      }
      textY += 4;
    }

    if (item.bodyLines.length > 0) {
      ctx.fillStyle = block.kind === 'conflict' ? '#78350f' : '#334155';
      ctx.font = '400 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      for (const bLine of item.bodyLines) {
        ctx.fillText(bLine, textX, textY);
        textY += 20;
      }
    }

    cursorY += item.boxHeight;
  }

  // Footer
  const footerY = totalHeight - footerHeight;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, footerY, width, footerHeight);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(width, footerY);
  ctx.stroke();

  ctx.fillStyle = '#475569';
  ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const sourceLabel = primaryCit
    ? `Sumber Resmi: ${primaryCit.docNumber} · ${primaryCit.title} (v${primaryCit.version})`
    : 'Sajian Visual Jawaban · NARA AI';
  ctx.fillText(sourceLabel.slice(0, 82), padX, footerY + 28);

  ctx.fillStyle = '#64748b';
  ctx.font = '400 11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('Diverifikasi dari SOP berstatus Disetujui', padX, footerY + 46);

  return canvas.toDataURL('image/png');
}
