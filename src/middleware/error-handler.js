const errorHandler = (err, req, res, next) => {
  console.error('[Error Handler]', err.stack);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Erro interno no servidor';

  res.status(statusCode).json({
    erro: message,
    // Stack apenas em desenvolvimento se necessário
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

module.exports = errorHandler;
