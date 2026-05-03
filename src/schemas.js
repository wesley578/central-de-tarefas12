const { z } = require('zod');

const EmpresaSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  cnpj: z.string().optional().nullable(),
  regime: z.string().optional().nullable(),
  tarefas_ids: z.array(z.number()).optional()
});

const EmpresaUpdateSchema = EmpresaSchema.extend({
  ativo: z.number().optional()
});

const TarefaSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  categoria: z.string().optional().nullable(),
  descricao: z.string().optional().nullable(),
  dia_vencimento: z.number().min(1).max(31).optional().nullable()
});

const ExecucaoUpdateSchema = z.object({
  o_que_foi_feito: z.string().nullable().optional(),
  quando: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  status: z.enum(['pendente', 'em_andamento', 'concluida', 'bloqueada']).optional(),
  responsavel: z.string().nullable().optional()
});

module.exports = {
  EmpresaSchema,
  EmpresaUpdateSchema,
  TarefaSchema,
  ExecucaoUpdateSchema
};
