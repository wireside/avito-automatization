import { createHash } from 'node:crypto';
const script = `const button=document.getElementById('download'),message=document.getElementById('message');const ticket=location.hash.slice(1);button.addEventListener('click',async()=>{button.disabled=true;try{const r=await fetch('/api/v1/local-signer/install',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok)throw Error();const href=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=href;a.download='AvitoSigner-Windows.zip';a.click();setTimeout(()=>URL.revokeObjectURL(href),60000);message.textContent='Если архив не появился, скопируйте полный адрес страницы и вставьте его в новую вкладку Chrome. Распакуйте архив и запустите Установить.cmd. Затем подтвердите компьютер в Telegram.';}catch{message.textContent='Ссылка недействительна или сервер недоступен. Получите новую ссылку командой /signer в боте.';}finally{button.disabled=false;}});if(!/^[A-Za-z0-9_-]{43}$/.test(ticket)){button.disabled=true;message.textContent='Откройте ссылку, которую выдал наш Telegram-бот.';}`;
const style =
  'body{font:18px system-ui;background:#0e1115;color:#eee;max-width:640px;margin:64px auto;padding:24px;line-height:1.6}button{font:inherit;padding:14px 24px;border:0;border-radius:12px;background:#8eade0;color:#050607;cursor:pointer}button:disabled{opacity:.5}';
export const signerInstallPage = {
  html:
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключение подписи</title><style>' +
    style +
    '</style><h1>Подключить подпись на Windows</h1><p>Откройте эту страницу на компьютере владельца ИП с подключённым токеном УКЭП.</p><button id="download">Скачать установщик</button><p id="message">Установка не передаёт закрытый ключ и PIN. Компьютер подключится после вашего подтверждения в Telegram.</p><script>' +
    script +
    '</script></html>',
  csp:
    "default-src 'none'; connect-src 'self'; script-src 'sha256-" +
    createHash('sha256').update(script).digest('base64') +
    "'; style-src 'sha256-" +
    createHash('sha256').update(style).digest('base64') +
    "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
