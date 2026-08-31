/**
 * viral remix — the angles, the brief, and the originality gate.
 *
 * The gate is the point: "lo copio y le cambio dos palabras" is exactly what
 * gets an account throttled for duplicate content, so a draft that is still
 * a near-copy has to say so out loud.
 */

import { describe, test, expect } from 'bun:test';
import { COPY_THRESHOLD, originalityCheck, promptFor, remixAngles, similarity } from '../viral/src/remix';
import type { ViralItem } from '../viral/src/types';

function item(over: Partial<ViralItem> = {}): ViralItem {
  return {
    id: 't3_x', kind: 'post', source: 'reddit', community: 'SpanishMeme', author: 'u',
    title: 'Cuando el lunes te mira fijamente', text: '', url: 'https://www.reddit.com/r/SpanishMeme/comments/x/',
    isImage: true, createdUtc: 1_700_000_000, score: 4200, comments: 310, over18: false, ...over,
  };
}

describe('remixAngles', () => {
  test('gives six distinct angles, each with a hook and a format', () => {
    const angles = remixAngles(item());
    expect(angles).toHaveLength(6);
    expect(new Set(angles.map((a) => a.id)).size).toBe(6);
    for (const a of angles) {
      expect(a.hook.length).toBeGreaterThan(0);
      expect(a.format.length).toBeGreaterThan(0);
      expect(['superficial', 'medio', 'profundo']).toContain(a.changeLevel);
    }
  });

  test('at least half the angles demand a deep change, not a coat of paint', () => {
    const deep = remixAngles(item()).filter((a) => a.changeLevel === 'profundo');
    expect(deep.length).toBeGreaterThanOrEqual(2);
  });

  test('the niche lands inside the angles instead of a generic placeholder', () => {
    const withNiche = remixAngles(item(), { niche: 'gimnasio' });
    expect(withNiche.some((a) => a.idea.includes('gimnasio'))).toBe(true);
    expect(remixAngles(item()).some((a) => a.idea.includes('tu nicho'))).toBe(true);
  });

  test('a long original is truncated into the angle, not dumped whole', () => {
    const long = 'x'.repeat(500);
    const angles = remixAngles(item({ title: long }));
    expect(angles[0].idea.length).toBeLessThan(300);
    expect(angles[0].idea).toContain('...');
  });

  test('a comment flips the format angle: the line becomes the headline', () => {
    const forComment = remixAngles(item({ kind: 'comment', title: '', text: 'Le dije que sabía conducir manual.' }));
    expect(forComment.find((a) => a.id === 'formato')!.idea).toContain('comentario');
  });
});

describe('promptFor', () => {
  test('carries the metrics, the angle and an explicit no-copy rule', () => {
    const angles = remixAngles(item(), { niche: 'programación' });
    const prompt = promptFor(item(), angles[0], { niche: 'programación' });
    expect(prompt).toContain('programación');
    expect(prompt).toContain('4200 votos');
    expect(prompt).toContain('NO copiar');
    expect(prompt).toContain('Nada de frases textuales');
  });

  test('an enormous source is clipped so the brief stays pasteable', () => {
    const prompt = promptFor(item({ text: 'y'.repeat(5000) }), remixAngles(item())[0]);
    expect(prompt.length).toBeLessThan(2000);
  });
});

describe('similarity', () => {
  test('identical text is 1, unrelated text is near 0', () => {
    expect(similarity('el lunes me mira fijamente', 'el lunes me mira fijamente')).toBe(1);
    expect(similarity('el lunes me mira fijamente', 'receta de tortilla de patatas')).toBeLessThan(0.2);
  });

  test('accents and casing do not fool it', () => {
    expect(similarity('El Lunes Me Mira Fíjamente', 'el lunes me mira fijamente')).toBeGreaterThan(0.9);
  });

  test('is symmetric and safe on empty input', () => {
    const a = 'una frase cualquiera';
    const b = 'otra frase distinta';
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10);
    expect(similarity('', 'algo')).toBe(0);
    expect(similarity('', '')).toBe(1);
  });
});

describe('originalityCheck', () => {
  const source = 'Dije que sabía conducir manual y acabé pagando el embrague del coche de mi jefe.';

  test('a two-word swap is caught as the same post wearing a hat', () => {
    const draft = 'Dije que sabía conducir manual y acabé pagando el embrague del coche de mi jefa.';
    const check = originalityCheck(source, draft);
    expect(check.similarity).toBeGreaterThan(COPY_THRESHOLD);
    expect(check.warning).toContain('duplicado');
  });

  test('a genuine rewrite passes with no warning', () => {
    const draft = 'Mentí en la entrevista sobre saber Kubernetes. Tres semanas después me tocó arreglar el clúster en producción un domingo.';
    const check = originalityCheck(source, draft);
    expect(check.similarity).toBeLessThan(COPY_THRESHOLD);
    expect(check.warning).toBeNull();
  });

  test('reports the number it judged on, so the call is auditable', () => {
    const check = originalityCheck(source, source);
    expect(check.similarity).toBe(1);
    expect(check.warning).toContain('100%');
  });
});
