export const sendError = (res, error, status = 400) => {
  res.status(status).json({ message: error?.message || 'Request failed' })
}

