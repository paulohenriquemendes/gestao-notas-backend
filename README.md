# Backend - Gestão de Notas Fiscais

API REST responsável por autenticação, persistência das notas fiscais e cálculo dos estados de prazo.

## Stack

- Node.js
- Express
- TypeScript
- Prisma
- PostgreSQL
- JWT
- bcrypt
- Zod

## Estrutura principal

```text
backend/
├── prisma/
│   └── seed.ts
├── src/
│   ├── controllers/
│   ├── middlewares/
│   ├── prisma/
│   ├── routes/
│   ├── types/
│   ├── utils/
│   └── server.ts
├── .env.example
├── package.json
├── tsconfig.json
├── vercel.json
└── README.md
```

## Modelos Prisma

### User

- `id`
- `nome`
- `email`
- `senhaHash`
- `role`

### NotaFiscal

- `id`
- `numero`
- `cliente`
- `destinatario`
- `observacoes`
- `dataEmissao`
- `dataChegada`
- `dataLimite`
- `userId`

## Regras de status calculadas pela API

- `atrasada`
- `venceHoje`
- `venceAmanha`
- `venceEm3Dias`
- `dentroPrazo`

A rota `GET /api/notas` devolve também:

- `diasDesdeChegada`
- `diasRestantes`
- `status`

## Variáveis de ambiente

Crie um arquivo `.env` com base em `.env.example`.

```env
DATABASE_URL="postgresql://usuario:senha@host.neon.tech/neondb?sslmode=require"
JWT_SECRET="sua-chave-segura"
PORT=3333
```

## Scripts

```bash
npm install
npm run dev
npm run build
npm run start
npm run prisma:generate
npm run prisma:push
npm run prisma:migrate
npm run seed
```

## Rodando localmente

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:push
npm run seed
npm run dev
```

## Seed inicial

O arquivo [prisma/seed.ts](/C:/Users/p-h-m/Downloads/DEV2026/gestão-notas/backend/prisma/seed.ts) cria:

- dados de exemplo para facilitar testes locais
- notas fiscais cobrindo todos os estados do dashboard

Recomendações:

- use o seed apenas em ambiente de desenvolvimento
- altere quaisquer acessos de teste antes de publicar o sistema
- não exponha credenciais em documentação, e-mails ou páginas públicas

## Endpoints

### Health check

- `GET /api/health`

### Autenticação

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/profile`

### Notas fiscais

Todas as rotas abaixo exigem:

```http
Authorization: Bearer SEU_TOKEN
```

- `GET /api/notas`
- `GET /api/notas/:id`
- `POST /api/notas`
- `PUT /api/notas/:id`
- `DELETE /api/notas/:id`
- `GET /api/notas/alertas`
- `GET /api/notas/sugestoes`
- `GET /api/notas/exportar`

Exemplo de payload:

```json
{
  "numero": "NF-2026-001",
  "cliente": "Química Alfa",
  "destinatario": "Planta Norte",
  "observacoes": "Entrega prioritária para conferência.",
  "dataEmissao": "2026-04-05",
  "dataChegada": "2026-04-06",
  "dataLimite": "2026-04-09"
}
```

## Regras de acesso

- usuários com perfil `ADMIN` visualizam notas de todos os usuários
- usuários com perfil `OPERADOR` visualizam apenas as próprias notas

## Deploy

### Produção atual

- API: [https://gestao-notas-backend.vercel.app](https://gestao-notas-backend.vercel.app)

### Configuração no Vercel

- Projeto: `gestao-notas-backend`
- Variáveis obrigatórias:
  - `DATABASE_URL`
  - `JWT_SECRET`

### Observações de deploy

- o `postinstall` gera automaticamente o client do Prisma
- o banco pode ser sincronizado com `prisma db push`
- o seed pode ser executado manualmente após preparar o banco

## Arquivos importantes

- Entrada da API: [src/server.ts](/C:/Users/p-h-m/Downloads/DEV2026/gestão-notas/backend/src/server.ts)
- Autenticação: [src/controllers/authController.ts](/C:/Users/p-h-m/Downloads/DEV2026/gestão-notas/backend/src/controllers/authController.ts)
- CRUD de notas: [src/controllers/notaController.ts](/C:/Users/p-h-m/Downloads/DEV2026/gestão-notas/backend/src/controllers/notaController.ts)
- Schema Prisma: [src/prisma/schema.prisma](/C:/Users/p-h-m/Downloads/DEV2026/gestão-notas/backend/src/prisma/schema.prisma)
