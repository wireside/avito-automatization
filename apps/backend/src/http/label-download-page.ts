import { createHash } from 'node:crypto';
const script = `const button=document.getElementById('download'),message=document.getElementById('message');const ticket=location.hash.slice(1);button.addEventListener('click',async()=>{button.disabled=true;try{const r=await fetch('/api/v1/avito-label/download',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});if(!r.ok)throw Error();const href=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=href;a.download='avito-label.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);message.textContent='Загрузка PDF запрошена. Если файл не появился, откройте эту ссылку в отдельной вкладке браузера вне Telegram и повторите скачивание.';}catch{message.textContent='Не удалось получить PDF. Ссылка действует 10 минут. Вернитесь в заказ и получите новую ссылку.';}finally{button.disabled=false;}});if(!/^[A-Za-z0-9_-]{1,4096}$/.test(ticket)){button.disabled=true;message.textContent='Получите ссылку на этикетку в карточке заказа.';}`;
const style =
  'body{font:18px system-ui;background:#0e1115;color:#eee;max-width:640px;margin:64px auto;padding:24px;line-height:1.6}button{font:inherit;padding:14px 24px;border:0;border-radius:12px;background:#8eade0;color:#050607;cursor:pointer}button:disabled{opacity:.5}';
export const labelDownloadPage = {
  html:
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Этикетка Авито</title><style>' +
    style +
    '</style><h1>Этикетка Авито</h1><p>Скачайте PDF для печати. Ссылка действует 10 минут и предназначена только для вас.</p><button id="download">Скачать PDF</button><p id="message">Если страница открыта внутри Telegram, откройте её во внешнем браузере.</p><script>' +
    script +
    '</script></html>',
  csp:
    "default-src 'none'; connect-src 'self'; script-src 'sha256-" +
    createHash('sha256').update(script).digest('base64') +
    "'; style-src 'sha256-" +
    createHash('sha256').update(style).digest('base64') +
    "'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
