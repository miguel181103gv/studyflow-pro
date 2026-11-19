# StudyFlow Pro — Guia Rápido de Publicação (100% Gratuito)

Você só precisa fazer estes **3 passos uma única vez**. Depois disso, seu site fica no ar na Vercel, conectado ao seu GitHub, salvando tudo na nuvem em tempo real no PC e no iPhone.

---

## Passo 1: Criar o Banco de Dados no Supabase (Gratuito)
1. Acesse [supabase.com](https://supabase.com), entre com seu GitHub/Google e clique em **New Project** (dê o nome `studyflow`).
2. No menu lateral esquerdo, clique em **SQL Editor** → **New query**.
3. Abra o arquivo `supabase/schema.sql` que está dentro desta pasta, copie tudo, cole lá e clique em **Run**.
4. Para ativar o **Login com Google**:
   - No menu esquerdo do Supabase, vá em **Authentication** → **Providers** → **Google** e ative-o.
   - Copie a **Callback URL** que o Supabase mostra.
   - No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um **OAuth 2.0 Client ID (Web)**, cole a Callback URL do Supabase em *Authorized redirect URIs*, e cole o **Client ID** e **Client Secret** de volta no Supabase.
5. No Supabase, vá em **Project Settings** → **API** e anote dois códigos:
   - `Project URL` (será sua `NEXT_PUBLIC_SUPABASE_URL`)
   - `anon public` key (será sua `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

---

## Passo 2: Subir para o seu GitHub
1. Crie um repositório novo no GitHub (ex: `studyflow-pro`).
2. Envie todos os arquivos desta pasta (descompactados do `.zip`) para o repositório — pode arrastar direto pelo site do GitHub (*Add file → Upload files*).

---

## Passo 3: Publicar na Vercel (Gratuito)
1. Acesse [vercel.com](https://vercel.com) e clique em **Add New → Project**.
2. Escolha o repositório `studyflow-pro` do seu GitHub.
3. Antes de clicar em Deploy, abra **Environment Variables** e adicione estas **3 variáveis**:
   - `NEXT_PUBLIC_SUPABASE_URL` = *(sua Project URL do Supabase)*
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = *(sua anon key do Supabase)*
   - `GEMINI_API_KEY` = *(sua chave do Google AI Studio)*
4. Clique em **Deploy**!
5. Quando terminar, copie a URL do seu site na Vercel (ex: `https://studyflow-pro.vercel.app`) e cole no Supabase em **Authentication → URL Configuration → Site URL**.

Pronto! Agora é só abrir o link no Windows e no iPhone (pode até clicar em *Compartilhar → Adicionar à Tela de Início* no Safari do iPhone para virar um aplicativo).
