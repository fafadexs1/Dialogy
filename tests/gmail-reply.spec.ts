import {describe,expect,it} from 'vitest';
import {buildGmailReply} from '@/modules/nexus/services/gmail-reply';
const input={to:'ana@example.com',subject:'Reunião sobre ações',inReplyTo:'<orig-123@example.com>',threadId:'thread_123',text:'Olá, confirmado!'};
describe('Gmail reply composition',()=>{
 it('creates a threaded MIME message with reviewable original arguments',()=>{
  const result=buildGmailReply(input); const mime=Buffer.from(result.raw,'base64url').toString('utf8');
  expect(result.threadId).toBe(input.threadId);expect(mime).toContain('To: ana@example.com\r\n');expect(mime).toContain('In-Reply-To: <orig-123@example.com>\r\nReferences: <orig-123@example.com>');
  const [head,body]=mime.split('\r\n\r\n'); expect(head).toContain('Subject: =?UTF-8?B?'); expect(Buffer.from(body,'base64').toString('utf8')).toBe(input.text);
 });
 it.each([{to:'ana@example.com\r\nBcc:attacker@example.com'},{subject:'title\r\nBcc:attacker@example.com'},{inReplyTo:'<ok@example.com>\r\nBcc:attacker@example.com'},{threadId:'../other'}])('rejects header injection and unsafe identifiers',partial=>expect(()=>buildGmailReply({...input,...partial})).toThrow());
 it('folds long non-ASCII subjects into valid encoded words',()=>{
  const mime=Buffer.from(buildGmailReply({...input,subject:'Conexão '.repeat(50)}).raw,'base64url').toString('utf8');
  const subject=mime.slice(mime.indexOf('Subject: '),mime.indexOf('\r\nIn-Reply-To:'));
  expect(subject.split('\r\n').every(line=>line.length<=76)).toBe(true);
 });
});
