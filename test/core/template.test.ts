import { describe, expect, it } from 'vitest';
import { TemplateError } from '../../src/core/errors.js';
import { render, variablesOf } from '../../src/core/template.js';

describe('variablesOf', () => {
  it('returns names in first-appearance order', () => {
    expect(variablesOf('{{ b }} {{a}} {{ c }}')).toEqual(['b', 'a', 'c']);
  });

  it('deduplicates repeated names but keeps the first position', () => {
    expect(variablesOf('{{a}} {{b}} {{ a }}')).toEqual(['a', 'b']);
  });

  it('returns an empty list for a template with no placeholders', () => {
    expect(variablesOf('nothing here')).toEqual([]);
  });

  it('accepts dots, dashes and underscores in names', () => {
    expect(variablesOf('{{ a.b-c_d }}')).toEqual(['a.b-c_d']);
  });
});

describe('render', () => {
  it('substitutes with and without surrounding spaces', () => {
    expect(render('{{name}}/{{ name }}/{{  name  }}', { name: 'x' })).toBe('x/x/x');
  });

  it('leaves text without placeholders unchanged', () => {
    expect(render('plain text, no tokens', {})).toBe('plain text, no tokens');
  });

  it('leaves a lone closing brace pair as is', () => {
    expect(render('a }} b', {})).toBe('a }} b');
  });

  it('stringifies numbers and booleans', () => {
    expect(render('{{n}} {{t}} {{f}} {{z}}', { n: 42, t: true, f: false, z: 0 })).toBe(
      '42 true false 0',
    );
  });

  it('ignores extra variables', () => {
    expect(render('{{a}}', { a: '1', b: '2' })).toBe('1');
  });

  it('reports every missing variable, sorted and deduplicated', () => {
    let caught: unknown;
    try {
      render('{{ z }} {{ a }} {{ m }} {{ a }} {{ present }}', { present: 'yes' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemplateError);
    const error = caught as TemplateError;
    expect(error.missing).toEqual(['a', 'm', 'z']);
    expect(error.message).toBe('missing template variable(s): a, m, z');
  });

  it('throws on an unclosed placeholder', () => {
    expect(() => render('hello {{ name', { name: 'x' })).toThrow(TemplateError);
    expect(() => render('hello {{ name', { name: 'x' })).toThrow(/unclosed "\{\{"/);
  });

  it('throws on an empty placeholder', () => {
    expect(() => render('a {{ }} b', {})).toThrow(TemplateError);
    expect(() => render('a {{ }} b', {})).toThrow(/empty placeholder/);
  });

  it('throws on an invalid variable name', () => {
    expect(() => render('{{ 1bad }}', {})).toThrow(TemplateError);
    expect(() => render('{{ 1bad }}', {})).toThrow(/invalid variable name "1bad"/);
  });

  it('reports malformed placeholders with no missing names', () => {
    let caught: unknown;
    try {
      variablesOf('{{ bad name }}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TemplateError);
    expect((caught as TemplateError).missing).toEqual([]);
  });
});
