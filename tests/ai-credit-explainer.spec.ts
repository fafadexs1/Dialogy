import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiCreditExplainer } from '@/components/billing/ai-credit-explainer';

const render = (creditValueBrl:number) => renderToStaticMarkup(React.createElement(AiCreditExplainer,{creditValueBrl})).replace(/\u00a0/g,' ');

describe('Customer-facing AI credit equivalence',()=>{
  it('shows the requested table and the current unit value',()=>{
    const html=render(.01);
    expect(html).toContain('1 crédito de IA equivale a R$ 0,01');
    for(const value of ['100','1.000','10.000','R$ 1,00','R$ 10,00','R$ 100,00'])expect(html).toContain(value);
    expect(html).toContain('Equivalência de créditos');
  });
  it('follows the configured credit value instead of hardcoding the original table',()=>{
    const html=render(.02);
    for(const value of ['R$ 0,02','R$ 2,00','R$ 20,00','R$ 200,00'])expect(html).toContain(value);
    expect(html).not.toContain('R$ 0,01');
  });
  it('does not round a small nonzero unit value down to zero',()=>{
    expect(render(.000001)).toContain('1 crédito de IA equivale a R$ 0,000001');
  });
  it('explains variable consumption and reservations without exposing supplier costs',()=>{
    const html=render(.01);
    expect(html).toContain('um crédito não equivale a uma quantidade fixa de mensagens');
    expect(html).toContain('O consumo pode ser fracionado');
    expect(html).toContain('Uma reserva não é uma cobrança concluída');
    expect(html).not.toMatch(/DeepSeek|Gemini|OpenAI|US\$|cotação|fornecedor/i);
  });
  it('does not invent an equivalence when the value is invalid',()=>{
    for(const value of [0,-1,NaN,Infinity])expect(render(value)).toBe('');
  });
});
