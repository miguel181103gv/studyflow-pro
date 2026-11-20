import type { Profile } from './types';

export type StudyMode = 'concurso' | 'faculdade' | 'escola' | 'certificacao' | 'livre' | 'outro';

export interface StudyModeConfig {
  id: StudyMode;
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  cardSubtitle: string;
  description: string;
  hasEdital: boolean;
  hasSalaryRaioX: boolean;
  showSimulados: boolean;
  showMapa: boolean;
  showAgendaTasksHighlight: boolean;
  profileSingular: string;
  switchProfileLabel: string;
  syllabusNavLabel: string;
  syllabusPageTitle: string;
  syllabusPageSubtitle: string;
  syllabusShort: string;
  simuladosNavLabel: string;
  simuladosPageTitle: string;
  examDateLabel: string;
  nameLabel: string;
  namePlaceholder: string;
  roleLabel: string;
  rolePlaceholder: string;
  defaultSubjects: { name: string; category: string; topics: string[] }[];
}

export const STUDY_MODES: Record<StudyMode, StudyModeConfig> = {
  concurso: {
    id: 'concurso',
    label: 'Concurso',
    shortLabel: 'Concurso',
    icon: '🏛️',
    color: '#0d9488',
    cardSubtitle: 'Edital, matérias e prova',
    description: 'Busca no PCI Concursos, leitor de edital em PDF, módulos comuns/exclusivos e Raio-X.',
    hasEdital: true,
    hasSalaryRaioX: true,
    showSimulados: true,
    showMapa: true,
    showAgendaTasksHighlight: false,
    profileSingular: 'Concurso',
    switchProfileLabel: 'Trocar de Perfil',
    syllabusNavLabel: 'Edital Verticalizado',
    syllabusPageTitle: 'Edital Verticalizado',
    syllabusPageSubtitle: 'Cada tópico evolui de cor conforme você estuda e conclui as revisões de 1, 7 e 30 dias.',
    syllabusShort: 'Edital',
    simuladosNavLabel: 'Simulados',
    simuladosPageTitle: 'Simulados',
    examDateLabel: 'Data da Prova',
    nameLabel: 'Concurso / Órgão *',
    namePlaceholder: 'Ex: TRT-MG, Banco do Brasil, INSS',
    roleLabel: 'Cargo',
    rolePlaceholder: 'Ex: Técnico Judiciário — Área Administrativa',
    defaultSubjects: [],
  },
  faculdade: {
    id: 'faculdade',
    label: 'Faculdade',
    shortLabel: 'Faculdade',
    icon: '🎓',
    color: '#4f46e5',
    cardSubtitle: 'Disciplinas e avaliações',
    description: 'Curso, semestre, disciplinas, aulas, trabalhos e provas sem precisar de edital.',
    hasEdital: false,
    hasSalaryRaioX: false,
    showSimulados: true,
    showMapa: false,
    showAgendaTasksHighlight: true,
    profileSingular: 'Faculdade',
    switchProfileLabel: 'Trocar de Perfil',
    syllabusNavLabel: 'Disciplinas e Conteúdo',
    syllabusPageTitle: 'Disciplinas e Conteúdo',
    syllabusPageSubtitle: 'Organize matéria → tema → tópico e agende revisões automáticas antes das provas.',
    syllabusShort: 'Conteúdo',
    simuladosNavLabel: 'Provas & Trabalhos',
    simuladosPageTitle: 'Provas & Trabalhos',
    examDateLabel: 'Próxima Avaliação (opcional)',
    nameLabel: 'Curso / Faculdade *',
    namePlaceholder: 'Ex: Direito — 3º Semestre, Engenharia Civil',
    roleLabel: 'Semestre / Instituição (opcional)',
    rolePlaceholder: 'Ex: 3º Semestre · UFJF',
    defaultSubjects: [
      { name: 'Disciplina 1', category: 'Semestre', topics: ['Unidade 1 — Fundamentos', 'Unidade 2 — Aprofundamento'] },
      { name: 'Disciplina 2', category: 'Semestre', topics: ['Unidade 1 — Conceitos Iniciais'] },
    ],
  },
  escola: {
    id: 'escola',
    label: 'Escola',
    shortLabel: 'Escola',
    icon: '🏫',
    color: '#0284c7',
    cardSubtitle: 'Matérias e tarefas',
    description: 'Série, matérias escolares, calendário de provas, deveres e revisões.',
    hasEdital: false,
    hasSalaryRaioX: false,
    showSimulados: true,
    showMapa: false,
    showAgendaTasksHighlight: true,
    profileSingular: 'Escola',
    switchProfileLabel: 'Trocar de Perfil',
    syllabusNavLabel: 'Matérias e Conteúdo',
    syllabusPageTitle: 'Matérias e Conteúdo',
    syllabusPageSubtitle: 'Marque os temas vistos em aula para revisar antes das avaliações.',
    syllabusShort: 'Conteúdo',
    simuladosNavLabel: 'Provas & Avaliações',
    simuladosPageTitle: 'Provas & Avaliações',
    examDateLabel: 'Próxima Prova (opcional)',
    nameLabel: 'Série / Ano Escolar *',
    namePlaceholder: 'Ex: 2º Ano — Ensino Médio',
    roleLabel: 'Escola / Turma (opcional)',
    rolePlaceholder: 'Ex: Turma A · 1º Trimestre',
    defaultSubjects: [
      { name: 'Língua Portuguesa', category: 'Linguagens', topics: ['Interpretação de Texto', 'Gramática', 'Literatura'] },
      { name: 'Matemática', category: 'Exatas', topics: ['Funções', 'Geometria', 'Porcentagem'] },
      { name: 'História', category: 'Humanas', topics: ['História do Brasil', 'História Geral'] },
      { name: 'Geografia', category: 'Humanas', topics: ['Geografia Física', 'Geopolítica'] },
      { name: 'Física', category: 'Natureza', topics: ['Cinemática', 'Dinâmica'] },
      { name: 'Química', category: 'Natureza', topics: ['Química Geral', 'Estequiometria'] },
      { name: 'Biologia', category: 'Natureza', topics: ['Citologia', 'Genética', 'Ecologia'] },
      { name: 'Redação', category: 'Linguagens', topics: ['Estrutura Dissertativa', 'Repertório'] },
    ],
  },
  certificacao: {
    id: 'certificacao',
    label: 'Certificação',
    shortLabel: 'Certificação',
    icon: '🏅',
    color: '#d97706',
    cardSubtitle: 'Conteúdo e exame',
    description: 'Certificações (CPA-20, AWS, OAB, ENEM): conteúdo programático, simulados e exame.',
    hasEdital: false,
    hasSalaryRaioX: false,
    showSimulados: true,
    showMapa: true,
    showAgendaTasksHighlight: false,
    profileSingular: 'Certificação',
    switchProfileLabel: 'Trocar de Perfil',
    syllabusNavLabel: 'Conteúdo Programático',
    syllabusPageTitle: 'Conteúdo Programático',
    syllabusPageSubtitle: 'Domine cada domínio do exame com revisões espaçadas e simulados cronometrados.',
    syllabusShort: 'Conteúdo',
    simuladosNavLabel: 'Simulados',
    simuladosPageTitle: 'Simulados do Exame',
    examDateLabel: 'Data do Exame (opcional)',
    nameLabel: 'Nome da Certificação / Exame *',
    namePlaceholder: 'Ex: CPA-20, AWS Cloud, OAB, ENEM',
    roleLabel: 'Nível / Banca (opcional)',
    rolePlaceholder: 'Ex: ANBIMA · Meta 80%',
    defaultSubjects: [
      { name: 'Domínio 1 — Fundamentos', category: 'Exame', topics: ['Conceitos Base', 'Regras Principais'] },
      { name: 'Domínio 2 — Prática & Casos', category: 'Exame', topics: ['Questões Comentadas', 'Revisão Final'] },
    ],
  },
  livre: {
    id: 'livre',
    label: 'Estudo livre',
    shortLabel: 'Estudo livre',
    icon: '🚀',
    color: '#7c3aed',
    cardSubtitle: 'Monte seu próprio plano',
    description: 'Sem edital nem simulados obrigatórios: defina seus temas, metas e ritmo.',
    hasEdital: false,
    hasSalaryRaioX: false,
    showSimulados: false,
    showMapa: false,
    showAgendaTasksHighlight: false,
    profileSingular: 'Estudo livre',
    switchProfileLabel: 'Trocar de Perfil',
    syllabusNavLabel: 'Plano de Estudos',
    syllabusPageTitle: 'Plano de Estudos',
    syllabusPageSubtitle: 'Organize seus temas pessoais, anotações e flashcards no seu ritmo.',
    syllabusShort: 'Plano',
    simuladosNavLabel: 'Práticas',
    simuladosPageTitle: 'Práticas',
    examDateLabel: 'Data da Meta (opcional)',
    nameLabel: 'Nome do Objetivo *',
    namePlaceholder: 'Ex: Inglês Fluente, Programação, Produção Musical',
    roleLabel: 'Objetivo Pessoal (opcional)',
    rolePlaceholder: 'Ex: Conversação fluente até dezembro',
    defaultSubjects: [
      { name: 'Tema 1 — Base', category: 'Estudo Livre', topics: ['Fundamentos', 'Prática Diária'] },
      { name: 'Tema 2 — Evolução', category: 'Estudo Livre', topics: ['Exercícios Aplicados', 'Projeto Pessoal'] },
    ],
  },
  outro: {
    id: 'outro',
    label: 'Outro',
    shortLabel: 'Personalizado',
    icon: '✨',
    color: '#0f766e',
    cardSubtitle: 'Configure do seu jeito',
    description: 'Crie um espaço genérico com nome próprio e organize matérias e tarefas livremente.',
    hasEdital: false,
    hasSalaryRaioX: false,
    showSimulados: false,
    showMapa: false,
    showAgendaTasksHighlight: false,
    profileSingular: 'Plano personalizado',
    switchProfileLabel: 'Trocar de Perfil',
    syllabusNavLabel: 'Conteúdos',
    syllabusPageTitle: 'Conteúdos do Plano',
    syllabusPageSubtitle: 'Adicione suas matérias e tópicos do jeito que preferir.',
    syllabusShort: 'Conteúdo',
    simuladosNavLabel: 'Avaliações',
    simuladosPageTitle: 'Avaliações',
    examDateLabel: 'Data de referência (opcional)',
    nameLabel: 'Nome do Perfil *',
    namePlaceholder: 'Ex: Projeto Pessoal, Leitura Anual, Pesquisa',
    roleLabel: 'Descrição breve (opcional)',
    rolePlaceholder: 'Ex: Meus estudos e leituras de 2026',
    defaultSubjects: [
      { name: 'Matéria 1', category: 'Geral', topics: ['Tópico Inicial'] },
    ],
  },
};

export const STUDY_MODE_LIST: StudyModeConfig[] = [
  STUDY_MODES.concurso,
  STUDY_MODES.faculdade,
  STUDY_MODES.escola,
  STUDY_MODES.certificacao,
  STUDY_MODES.livre,
  STUDY_MODES.outro,
];

export function getStudyModeId(profile?: Pick<Profile, 'slug'> | null): StudyMode {
  const slug = profile?.slug || '';
  if (slug.startsWith('mode:')) {
    const raw = slug.slice(5);
    if (raw === 'vestibular') return 'certificacao';
    if (raw in STUDY_MODES) return raw as StudyMode;
  }
  return 'concurso';
}

export function getStudyMode(profile?: Pick<Profile, 'slug'> | null): StudyModeConfig {
  return STUDY_MODES[getStudyModeId(profile)];
}

export function encodeStudyModeSlug(mode: StudyMode): string {
  return `mode:${mode}`;
}
