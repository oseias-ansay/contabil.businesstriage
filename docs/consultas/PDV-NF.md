# Consulta PDV/NF: integração com PDV e emissão de notas fiscais

> Registro de consulta feita em outubro de 2026, ainda **sem implementação**. Serve de base para decidir
> o escopo de um futuro módulo ligado ao Triage Contábil.

## 1. Importação de dados de PDV

As empresas-alvo da Business Triage usam sistemas de PDV que integram os recebimentos de cartão e Pix.
Dá para importar esses dados por API. Neste caso as fontes são três:

- o próprio PDV, quando ele tem API: vendas, formas de pagamento e NFC-e emitidas;
- as adquirentes e subadquirentes (maquininhas), que trazem vendas, taxas e agenda de recebíveis;
- os bancos e o Pix, que trazem os valores efetivamente creditados. Hoje isso já entra pelos extratos
  da Fase 2 e, no futuro, pode vir pelo Open Finance.

Os requisitos são os seguintes:

- autorização do cliente: credenciais ou token de API de cada sistema, ou um convênio com o fornecedor;
- um conector por fornecedor, porque cada um tem o seu formato;
- a contabilização: venda bruta, taxa da adquirente como despesa e recebível a receber;
- a conciliação com o extrato bancário.

No varejo, a NFC-e normalmente já sai do PDV. O mais útil para essas empresas é **importar as notas
emitidas**, e não emiti-las de novo.

## 2. Emissão de notas fiscais

**Conclusão: é possível, mas como módulo à parte (ex.: "Triage Fiscal")**, ativado por plano. Nota
fiscal é documento oficial, com efeito tributário. Isso muda a natureza do produto em relação aos
demonstrativos informativos.

### Tipos

| Nota | Para quê | Onde é autorizada |
|---|---|---|
| NF-e (modelo 55) | venda de produtos entre empresas | SEFAZ do estado |
| NFC-e (modelo 65) | venda no varejo ao consumidor (cupom do PDV) | SEFAZ do estado |
| NFS-e | prestação de serviços | prefeitura, cada vez mais pelo Padrão Nacional (Emissor Nacional/ADN, API única) |

**Prazo relevante:** pela Resolução CGSN nº 191/2026, a partir de **1º/11/2026** as ME e EPP do
Simples Nacional que prestam serviços emitem NFS-e no Emissor Nacional, pelo site ou por API.

### Caminhos técnicos

1. **Ligar direto na SEFAZ e no ADN.** É preciso montar e assinar o XML, tratar a regra de cada estado,
   homologar, cuidar da contingência e acompanhar as notas técnicas. O custo de manutenção é alto.
2. **Usar um provedor de API de emissão** (Focus NFe, PlugNotas, Nuvem Fiscal etc.). Os dados vão em
   JSON e o provedor cuida da SEFAZ, das prefeituras e das mudanças de layout. A cobrança é por nota
   ou por CNPJ. **Este é o caminho recomendado.**

### Requisitos por empresa cliente

- **Certificado digital A1** de cada CNPJ, guardado criptografado. É o maior atrito no onboarding.
- **Cadastro fiscal:** IE e/ou IM, regime tributário, CNAE e, para NFC-e, o token CSC.
- **Códigos por item:**
  - produtos: NCM, CFOP, CST/CSOSN;
  - serviços: código da LC 116 e alíquota de ISS.
- **Numeração e série**, cancelamento dentro do prazo e carta de correção (CC-e).
- **Guarda do XML** por no mínimo 5 anos.
- **Reforma tributária:** os layouts de 2026 já trazem os campos de IBS e CBS (fase de teste).

### Integração com a contabilidade

Cada nota autorizada gera o lançamento sozinha:

- a receita: D Clientes / C Receita;
- os impostos destacados, como dedução;
- o recebível, que depois casa com o extrato bancário.

O mecanismo é o mesmo da Fase 3: um evento externo vira um lançamento, idempotente pelo número da nota.

### Cuidados

- **Responsabilidade:** o sistema emite, mas a classificação tributária (alíquota, CFOP, retenções) é
  do cliente ou do contador dele. Isso precisa estar explícito nos termos de uso.
- **Suporte:** rejeições, certificado vencido e prefeitura fora do ar viram chamados urgentes.
- **Custo:** a cobrança do provedor por nota ou CNPJ entra no preço do plano ou vira um adicional.

### Ordem sugerida

1. NFS-e Nacional via provedor, para as empresas de serviço do Simples.
2. NF-e, para quem vende produtos.
3. Importação das NFC-e que o PDV já emite, junto com a integração de PDV da seção 1.

Tudo isso entra depois da Fase 3 (Integrações), reaproveitando a infraestrutura de eventos para lançamentos.

## Fontes

- [Senior: Resolução CGSN nº 191/2026, NFS-e Padrão Nacional a partir de novembro](https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2026/2026-08-11-simples-nacional-resolucao-cgsn-no-191-2026-utilizacao-do-emissor-da-nfs-e-de-padrao-nacional-sera-a-partir-de-novembro)
- [Nota Gateway: obrigatoriedade da NFS-e Nacional para ME e EPP](https://notagateway.com.br/blog/obrigatoriedade-da-nfs-e-nacional-para-me-e-epp-do-simples-comeca-em-1o-de-novembro-de-2026/)
- [Focus NFe: NFS-e Nacional](https://focusnfe.com.br/produtos/nfse-nacional/)
- [Focus NFe: NF-e](https://focusnfe.com.br/produtos/nota-fiscal-eletronica-nfe/)
- [Focus NFe: NFC-e](https://focusnfe.com.br/produtos/nota-fiscal-consumidor-nfce/)
- [Notaas: comparativo de APIs de emissão 2026](https://www.notaas.com.br/blog/post/api-emissao-nota-fiscal-comparativo-plataformas-2026/)
