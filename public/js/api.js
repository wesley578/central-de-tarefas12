const API = '/api';

const api = async (url, method='GET', body=null, isFormData=false) => {
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const opts = { method, headers };
  if (body) opts.body = isFormData ? body : JSON.stringify(body);

  const r = await fetch(API + url, opts);
  
  if (r.status === 401 || r.status === 403) {
    localStorage.removeItem('token');
    window.location.reload();
  }

  if (!r.ok) {
    const errorData = await r.json().catch(() => ({ erro: 'Erro na requisição' }));
    throw new Error(errorData.erro || 'Erro na requisição');
  }

  return r.json();
};

const toast = (msg, c='var(--green)') => {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.borderColor = c; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
};
