const requireAdmin = (req, res, next) => {
  if (String(req.user?.role || '') !== 'admin') {
    res.status(403).json({
      code: 403,
      message: '没有后台访问权限',
      data: null,
    })
    return
  }
  next()
}

module.exports = {
  requireAdmin,
}
