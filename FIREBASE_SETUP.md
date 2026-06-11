# Configuracao completa do Firebase

Este tracker funciona em dois modos:

- **Local only:** os casos ficam no `localStorage` deste navegador.
- **Synced:** depois do login Google, os casos tambem ficam no Cloud Firestore e
  sao atualizados em tempo real em outros computadores conectados.

O modo local continua funcionando se a internet cair ou se o Firebase ainda nao
estiver configurado.

## Arquivos usados

- `firebase-config.js`: identificacao do projeto Firebase.
- `firebase-sync.js`: login Google e sincronizacao com o Firestore.
- `firestore.rules`: define quem pode ler e alterar casos.
- `firebase.json`: configuracao de deploy das regras e do Hosting.

## SDK Firebase x Firebase CLI

O comando ja executado:

```bash
npm install firebase
```

instala o **SDK JavaScript** no projeto. A implementacao atual da pagina estatica
usa os mesmos modulos diretamente do CDN oficial do Firebase em
`firebase-sync.js`. Portanto, o pacote npm esta disponivel para uma futura
migracao para Vite/webpack, mas nao e necessario para abrir a pagina hoje.

Para publicar regras e o site, voce tambem precisa do **Firebase CLI**:

```bash
npm install -g firebase-tools
firebase --version
```

SDK e CLI sao ferramentas diferentes.

## 1. Criar o projeto Firebase

1. Acesse [Firebase Console](https://console.firebase.google.com/).
2. Entre com a conta Google que administrara o projeto.
3. Clique em **Create a project** ou **Adicionar projeto**.
4. Informe um nome, por exemplo `BA Express Vetting`.
5. Confira o **Project ID** sugerido.

O Project ID precisa ser unico e nao pode ser alterado depois. Um exemplo seria:

```text
ba-express-vetting
```

6. Google Analytics e opcional para este tracker. Pode deixar desativado.
7. Clique em **Create project** e aguarde a conclusao.

## 2. Registrar a aplicacao Web

1. Na pagina inicial do projeto, clique no icone Web `</>`.
2. Em **App nickname**, informe `BA Express Vetting Tracker`.
3. Nao e necessario marcar Firebase Hosting nesse momento.
4. Clique em **Register app**.
5. O console exibira um objeto parecido com:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "ba-express-vetting.firebaseapp.com",
  projectId: "ba-express-vetting",
  storageBucket: "ba-express-vetting.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

Copie exatamente os valores apresentados pelo console. O `storageBucket` pode
ter outro formato em projetos antigos; use o valor fornecido pelo Firebase.

## 3. Preencher `firebase-config.js`

Abra `firebase-config.js` e substitua todos os valores `PASTE_...`:

```js
window.BA_FIREBASE = {
    config: {
        apiKey: "AIza...",
        authDomain: "ba-express-vetting.firebaseapp.com",
        projectId: "ba-express-vetting",
        storageBucket: "ba-express-vetting.firebasestorage.app",
        messagingSenderId: "123456789012",
        appId: "1:123456789012:web:abcdef123456"
    },
    workspaceId: "ba-express-vetting"
};
```

### O que significa cada campo

| Campo | Origem |
| --- | --- |
| `apiKey` | Chave publica que identifica a aplicacao Web |
| `authDomain` | Dominio usado pelo fluxo de Authentication |
| `projectId` | ID imutavel do projeto Firebase |
| `storageBucket` | Bucket do Cloud Storage, mesmo que ainda nao seja usado |
| `messagingSenderId` | ID numerico do remetente/projeto |
| `appId` | Identificador desta aplicacao Web |
| `workspaceId` | Nome logico usado pelo tracker no caminho do Firestore |

O `firebaseConfig` de uma aplicacao Web nao e uma senha. Ele aparece no codigo
enviado ao navegador. A protecao real vem do Google Authentication e das
Security Rules.

Nunca coloque no frontend:

- arquivo JSON de Service Account;
- private key;
- senha de banco;
- credencial do Firebase Admin SDK.

## 4. Ativar login Google

1. No menu lateral do Firebase, abra **Build > Authentication**.
2. Clique em **Get started**.
3. Abra a aba **Sign-in method**.
4. Selecione **Google**.
5. Ative o provedor.
6. Escolha um **Project support email**.
7. Clique em **Save**.

### Dominios autorizados

Abra **Authentication > Settings > Authorized domains** e confira:

- `localhost`, para testes locais;
- o dominio do Firebase Hosting, como
  `ba-express-vetting.web.app`;
- `baexpress.co.uk` ou o subdominio real, caso o tracker seja publicado ali.

Adicione somente o nome do dominio, sem `https://`, caminho ou porta:

```text
localhost
vetting.baexpress.co.uk
```

Se aparecer `auth/unauthorized-domain`, esse cadastro e o primeiro ponto a
verificar.

## 5. Criar o Cloud Firestore

1. No menu lateral, abra **Build > Firestore Database**.
2. Clique em **Create database**.
3. Selecione o banco `(default)`.
4. Escolha **Production mode**.
5. Escolha a regiao.

Prefira uma regiao proxima da operacao e confirme com cuidado: a localizacao do
banco nao deve ser tratada como algo simples de alterar depois.

6. Clique em **Enable**.

Production mode inicialmente bloqueia as operacoes Web. Isso e esperado; as
regras deste repositorio liberarao somente os usuarios autorizados.

## 6. Conferir as regras de acesso

O arquivo `firestore.rules` atual aceita usuarios autenticados cujo email
termine em:

```text
@baexpress.co.uk
```

Nao existem excecoes para Gmail ou outros dominios. O frontend e as regras do
Firestore exigem uma conta Google `@baexpress.co.uk`.

Trecho principal:

```javascript
function isBaExpressUser() {
  return request.auth != null
    && request.auth.token.email != null
    && request.auth.token.email.matches('.*@baexpress\\.co\\.uk$');
}
```

Nao use em producao:

```javascript
allow read, write: if true;
```

Esse comando torna os dados pessoais dos motoristas publicos para leitura e
alteracao.

## 7. Instalar e autenticar o Firebase CLI

Instale a ferramenta de deploy:

```bash
npm install -g firebase-tools
```

Entre na conta:

```bash
firebase login
```

Confirme que o projeto aparece:

```bash
firebase projects:list
```

O Firebase CLI exige Node.js 18 ou superior. Este projeto ja esta usando uma
versao compativel.

## 8. Associar esta pasta ao projeto

Esta pasta ja possui `firebase.json`, portanto nao e necessario executar
`firebase init` e correr o risco de sobrescrever a configuracao existente.

Na raiz do projeto, execute:

```bash
firebase use --add
```

1. Selecione o projeto criado.
2. Defina o alias `default`.

O comando criara `.firebaserc`, semelhante a:

```json
{
  "projects": {
    "default": "ba-express-vetting"
  }
}
```

Confirme a selecao:

```bash
firebase use
```

## 9. Publicar as regras

Execute:

```bash
firebase deploy --only firestore:rules
```

Resultado esperado:

```text
Deploy complete!
```

Tambem e possivel colar as regras manualmente em:

**Firestore Database > Rules**

Depois clique em **Publish**. Evite manter regras diferentes no console e no
arquivo local; o proximo deploy substituiria a versao do console.

## 10. Testar localmente

Nao abra `index.html` diretamente com `file://`. Authentication e modulos Web
funcionam de forma mais previsivel por HTTP.

Na raiz do projeto:

```bash
python3 -m http.server 4173
```

Abra:

```text
http://localhost:4173
```

Roteiro de teste:

1. Confirme que o topo mostra **Local only**.
2. Crie um caso de teste.
3. Clique em **Connect**.
4. Escolha uma conta permitida pelas regras.
5. Aguarde o indicador mostrar **Synced**.
6. No Firebase Console, abra **Firestore Database > Data**.
7. Confira o caminho:

```text
workspaces
  ba-express-vetting
    vendors
      ID_DO_CASO
```

8. Altere um campo no tracker.
9. Aguarde **Saving** mudar para **Synced**.
10. Atualize o documento no console para confirmar a alteracao.

## 11. Como ocorre a primeira sincronizacao

O comportamento implementado e:

1. Toda alteracao e salva primeiro no `localStorage`.
2. Sem login, nada e enviado ao Firestore.
3. Depois do login, o tracker le a colecao remota.
4. Se a colecao estiver vazia e houver casos locais, os casos locais sao
   enviados ao Firestore.
5. Se ja houver dados remotos, eles passam a ser a fonte compartilhada.
6. Alteracoes posteriores sao enviadas apos uma pausa curta de digitacao.
7. Somente casos modificados sao regravados.

Antes do primeiro login em um computador que ja possui dados, confirme se esta
usando o projeto Firebase correto.

## 12. Testar em dois navegadores

1. Entre no tracker no Chrome e faca login.
2. Abra o mesmo endereco no Edge, Firefox ou outro computador.
3. Faca login com outra conta autorizada.
4. Altere um caso no primeiro navegador.
5. A mudanca deve aparecer no segundo sem recarregar a pagina.

Se nao aparecer:

- confira se os dois usam o mesmo `projectId`;
- confira se os dois usam o mesmo `workspaceId`;
- veja o Console do navegador;
- confirme que ambos mostram **Synced**.

## 13. Publicar no Firebase Hosting

O `firebase.json` ja esta configurado para uma pagina estatica.

Publique regras e site:

```bash
firebase deploy --only firestore:rules,hosting
```

Ou apenas o site:

```bash
firebase deploy --only hosting
```

Ao final, o CLI mostrara enderecos semelhantes a:

```text
https://ba-express-vetting.web.app
https://ba-express-vetting.firebaseapp.com
```

Abra o endereco publicado e teste o login novamente.

## 14. Usar no GitHub Pages

Este repositorio tambem pode ser publicado em:

```text
https://j-mazini.github.io/dhl-vetting-tracker/
```

Para o login funcionar, `j-mazini.github.io` precisa estar cadastrado em:

**Firebase Authentication > Settings > Authorized domains**

O dominio ja foi adicionado ao projeto `vetting-63c6d`. O caminho
`/dhl-vetting-tracker/` nao deve ser incluido nessa lista, pois o Firebase pede
somente o host.

Os arquivos que precisam estar publicados junto com `index.html` sao:

```text
firebase-config.js
firebase-sync.js
BA_logo.png
```

A configuracao Web do Firebase pode ficar no repositorio publico. Nao publique
Service Accounts, private keys ou credenciais do Admin SDK.

## 15. Publicar em dominio proprio

Para usar algo como `vetting.baexpress.co.uk`:

1. Abra **Build > Hosting**.
2. Clique em **Add custom domain**.
3. Informe `vetting.baexpress.co.uk`.
4. Adicione no DNS os registros indicados pelo Firebase.
5. Aguarde a verificacao e emissao do certificado SSL.
6. Adicione `vetting.baexpress.co.uk` em
   **Authentication > Settings > Authorized domains**.

## 16. Solucao de problemas

### O botao continua mostrando `Local only`

- confirme que nenhum valor `PASTE_...` ficou em `firebase-config.js`;
- atualize a pagina sem cache;
- abra o Console do navegador e procure erros;
- confirme que `firebase-config.js` esta sendo servido com HTTP 200.

### `auth/unauthorized-domain`

Adicione o dominio atual em:

**Authentication > Settings > Authorized domains**

Para teste local, cadastre `localhost`, sem a porta.

### `permission-denied`

O login funcionou, mas o email nao foi aceito por `firestore.rules`, ou as
regras ainda nao foram publicadas.

Confira:

```bash
firebase deploy --only firestore:rules
```

Depois confirme se o email termina em `@baexpress.co.uk` ou esta explicitamente
permitido na regra.

### Popup de login fecha ou e bloqueado

- permita popups para o dominio;
- teste fora de uma janela privada restritiva;
- confirme que o provedor Google esta ativado;
- confira o dominio autorizado.

### `firebase: command not found`

O SDK foi instalado, mas o CLI nao:

```bash
npm install -g firebase-tools
```

Feche e reabra o terminal se necessario.

### Os dados aparecem somente em um computador

- confirme que ambos fizeram login;
- confirme o mesmo `projectId`;
- confirme o mesmo `workspaceId`;
- confirme que o topo mostra **Synced**, nao **Local only**.

### Nao aparece nenhum documento no Firestore

1. Crie ao menos um caso local.
2. Faca login.
3. Espere o indicador **Synced**.
4. Veja se ha erro `permission-denied`.
5. Confira a colecao no caminho correto:
   `workspaces/ba-express-vetting/vendors`.

## 17. Seguranca antes de producao

- mantenha as regras restritas a usuarios autenticados;
- use contas corporativas individuais, nao uma conta compartilhada;
- remova emails de teste das regras;
- ative MFA nas contas Google administrativas;
- revise periodicamente os usuarios em **Authentication > Users**;
- monitore uso e cobranca no Firebase Console;
- considere ativar Firebase App Check antes de uma implantacao ampla;
- mantenha backups/exportacoes conforme a politica de dados da empresa;
- confirme os requisitos de privacidade para data de nascimento, endereco,
  documentos e verificacoes criminais.

## Checklist final

- [ ] Projeto Firebase criado.
- [ ] Aplicacao Web registrada.
- [ ] `firebase-config.js` preenchido.
- [ ] Google Authentication ativado.
- [ ] Dominios autorizados cadastrados.
- [ ] Firestore `(default)` criado.
- [ ] Regra ajustada para os emails corretos.
- [ ] Firebase CLI instalado.
- [ ] Pasta associada com `firebase use --add`.
- [ ] Regras publicadas.
- [ ] Login local testado.
- [ ] Documento confirmado no Firestore.
- [ ] Sincronizacao testada em dois navegadores.
- [ ] Hosting publicado, se aplicavel.

## Documentacao oficial

- [Adicionar Firebase a um app Web](https://firebase.google.com/docs/web/setup)
- [Login Google para Web](https://firebase.google.com/docs/auth/web/google-signin)
- [Inicio rapido do Cloud Firestore](https://firebase.google.com/docs/firestore/quickstart)
- [Firebase CLI](https://firebase.google.com/docs/cli)
- [Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
