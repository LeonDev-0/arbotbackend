import { Router } from "express"
import multer from "multer"
import { UPLOADS_DIR } from "../config"
import { auth } from "../middleware/auth"

const router = Router()

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
})

router.post("/", ...auth, upload.single("archivo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No se recibió archivo" })
  res.json({ url: `/uploads/${req.file.filename}` })
})

export default router
