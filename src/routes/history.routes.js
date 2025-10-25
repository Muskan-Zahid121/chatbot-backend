import express from 'express';
import { listHistory, deleteHistory } from '../controllers/history.controller.js';

const router = express.Router();

router.get('/', listHistory);
router.delete('/', deleteHistory);
router.delete('/:id', deleteHistory);

export default router;


