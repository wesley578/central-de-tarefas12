const fs = require('fs');

let code = fs.readFileSync('server.js', 'utf8');

// 1. Zod
if (!code.includes("const { z } = require('zod');")) {
  code = code.replace(
    "const path = require('path');",
    "const path = require('path');\nconst { z } = require('zod');"
  );
}

// DB Path
code = code.replace(
  "const db = new Database(path.join(__dirname, 'tarefas.db'));",
  "const dbPath = process.env.DB_PATH || path.join(__dirname, 'tarefas.db');\nconst db = new Database(dbPath);"
);

// Zod schemas
const schemas = `
const EmpresaSchema = z.object({ nome: z.string().min(1, 'Nome obrigatório'), cnpj: z.string().optional().nullable(), regime: z.string().optional().nullable(), tarefas_ids: z.array(z.number()).optional() });
const EmpresaUpdateSchema = EmpresaSchema.extend({ ativo: z.number().optional() });
const TarefaSchema = z.object({ nome: z.string().min(1, 'Nome obrigatório'), categoria: z.string().optional().nullable(), descricao: z.string().optional().nullable() });
const ExecucaoUpdateSchema = z.object({ o_que_foi_feito: z.string().nullable().optional(), quando: z.string().nullable().optional(), observacoes: z.string().nullable().optional(), status: z.enum(['pendente','em_andamento','concluida','bloqueada']).optional(), responsavel: z.string().nullable().optional() });
`;

if (!code.includes('EmpresaSchema')) {
  code = code.replace(
    "const VALID_STATUS = ['pendente','em_andamento','concluida','bloqueada'];",
    "const VALID_STATUS = ['pendente','em_andamento','concluida','bloqueada'];\n" + schemas
  );
}

// Empresas post
code = code.replace(
  "const {nome, cnpj, regime, tarefas_ids} = req.body;\n  if (!nome) return res.status(400).json({erro:'Nome obrigatório'});",
  "const parsed = EmpresaSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});\n  const {nome, cnpj, regime, tarefas_ids} = parsed.data;"
);

// Empresas put
code = code.replace(
  "const {nome, cnpj, regime, ativo, tarefas_ids} = req.body;\n  if (!db.prepare('SELECT id FROM empresas WHERE id=?').get(req.params.id))",
  "const parsed = EmpresaUpdateSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});\n  const {nome, cnpj, regime, ativo, tarefas_ids} = parsed.data;\n  if (!db.prepare('SELECT id FROM empresas WHERE id=?').get(req.params.id))"
);

// Tarefas post
code = code.replace(
  "const {nome,categoria,descricao}=req.body;\n  if(!nome) return res.status(400).json({erro:'Nome obrigatório'});",
  "const parsed = TarefaSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});\n  const {nome,categoria,descricao}=parsed.data;"
);

// Tarefas put
code = code.replace(
  "const {nome,categoria,descricao}=req.body;\n  db.prepare('UPDATE",
  "const parsed = TarefaSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});\n  const {nome,categoria,descricao}=parsed.data;\n  db.prepare('UPDATE"
);

// Execucoes put
code = code.replace(
  "const {o_que_foi_feito,quando,observacoes,status,responsavel}=req.body;\n  if(status&&!VALID_STATUS.includes(status)) return res.status(400).json({erro:'Status inválido'});",
  "const parsed = ExecucaoUpdateSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});\n  const {o_que_foi_feito,quando,observacoes,status,responsavel}=parsed.data;"
);

// Historico put
code = code.replace(
  "const {o_que_foi_feito,quando,observacoes,status,responsavel}=req.body;\n  if(status&&!VALID_STATUS.includes(status)) return res.status(400).json({erro:'Status inválido'});",
  "const parsed = ExecucaoUpdateSchema.safeParse(req.body); if(!parsed.success) return res.status(400).json({erro:parsed.error.errors[0].message});\n  const {o_que_foi_feito,quando,observacoes,status,responsavel}=parsed.data;"
);

// Pagination Execucoes
const execGetOld = `app.get('/api/execucoes', (req,res) => {
  const {empresa_id,tarefa_id,status,categoria}=req.query;
  let q=\`SELECT e.*, em.nome AS empresa_nome, em.regime, t.nome AS tarefa_nome, t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1\`;
  const p=[];
  if(empresa_id){q+=' AND e.empresa_id=?';p.push(empresa_id);}
  if(tarefa_id){q+=' AND e.tarefa_id=?';p.push(tarefa_id);}
  if(status){q+=' AND e.status=?';p.push(status);}
  if(categoria){q+=' AND t.categoria=?';p.push(categoria);}
  res.json(db.prepare(q+' ORDER BY em.nome,t.categoria,t.nome').all(...p));
});`;

const execGetNew = `app.get('/api/execucoes', (req,res) => {
  const {empresa_id,tarefa_id,status,categoria,page=1,limit=50}=req.query;
  const pPage=Math.max(1,+page), pLimit=Math.max(1,+limit), offset=(pPage-1)*pLimit;
  let q=\`SELECT e.*, em.nome AS empresa_nome, em.regime, t.nome AS tarefa_nome, t.categoria FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1\`;
  let qC=\`SELECT COUNT(*) AS total FROM execucoes e JOIN empresas em ON em.id=e.empresa_id JOIN tarefas t ON t.id=e.tarefa_id WHERE 1=1\`;
  const p=[];
  if(empresa_id){q+=' AND e.empresa_id=?';qC+=' AND e.empresa_id=?';p.push(empresa_id);}
  if(tarefa_id){q+=' AND e.tarefa_id=?';qC+=' AND e.tarefa_id=?';p.push(tarefa_id);}
  if(status){q+=' AND e.status=?';qC+=' AND e.status=?';p.push(status);}
  if(categoria){q+=' AND t.categoria=?';qC+=' AND t.categoria=?';p.push(categoria);}
  const total = db.prepare(qC).get(...p).total;
  const data = db.prepare(q+' ORDER BY em.nome,t.categoria,t.nome LIMIT ? OFFSET ?').all(...p, pLimit, offset);
  res.json({data, total, page:pPage, limit:pLimit});
});`;
code = code.replace(execGetOld, execGetNew);

// Pagination Historico
const histGetOld = `app.get('/api/historico', (req,res) => {
  const {mes_referencia,empresa_id,status,categoria}=req.query;
  let q='SELECT * FROM historico WHERE 1=1'; const p=[];
  if(mes_referencia){q+=' AND mes_referencia=?';p.push(mes_referencia);}
  if(empresa_id){q+=' AND empresa_id=?';p.push(empresa_id);}
  if(status){q+=' AND status=?';p.push(status);}
  if(categoria){q+=' AND categoria=?';p.push(categoria);}
  res.json(db.prepare(q+' ORDER BY empresa_nome,categoria,tarefa_nome').all(...p));
});`;

const histGetNew = `app.get('/api/historico', (req,res) => {
  const {mes_referencia,empresa_id,status,categoria,page=1,limit=50}=req.query;
  const pPage=Math.max(1,+page), pLimit=Math.max(1,+limit), offset=(pPage-1)*pLimit;
  let q='SELECT * FROM historico WHERE 1=1'; 
  let qC='SELECT COUNT(*) AS total FROM historico WHERE 1=1'; 
  const p=[];
  if(mes_referencia){q+=' AND mes_referencia=?';qC+=' AND mes_referencia=?';p.push(mes_referencia);}
  if(empresa_id){q+=' AND empresa_id=?';qC+=' AND empresa_id=?';p.push(empresa_id);}
  if(status){q+=' AND status=?';qC+=' AND status=?';p.push(status);}
  if(categoria){q+=' AND categoria=?';qC+=' AND categoria=?';p.push(categoria);}
  const total = db.prepare(qC).get(...p).total;
  const data = db.prepare(q+' ORDER BY empresa_nome,categoria,tarefa_nome LIMIT ? OFFSET ?').all(...p, pLimit, offset);
  res.json({data, total, page:pPage, limit:pLimit});
});`;
code = code.replace(histGetOld, histGetNew);

fs.writeFileSync('server.js', code);
